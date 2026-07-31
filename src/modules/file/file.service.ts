import { extname } from "node:path";
import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { Readable } from "node:stream";
import { AppError } from "../../utils/app-error.js";
import type {
  FileDto,
  FilePage,
  FilePageDto,
  FilePageOptions,
  FileRecord,
  FileRepository,
  AnonymousAccess,
  TelegramStorage,
} from "./file.types.js";
import { toFileDto } from "./file.types.js";

export interface UploadInput {
  storageLocationId: bigint;
  parentId: bigint | null;
  filename: string;
  mimeType: string | null;
  stream: Readable;
  thumbnail?: Buffer;
  isTruncated?: () => boolean;
}

export interface DownloadResult {
  stream: Readable;
  filename: string;
  mimeType: string;
  size: bigint;
}

export type PrivateContentMode = "preview" | "download" | "thumbnail";

export interface PrivateContentLinkDto {
  fileId: string;
  token: string;
}

interface CreatedCopy {
  id: bigint;
}

export interface StorageLocationDto {
  id: string;
  name: string;
  anonymousAccess: AnonymousAccess;
  hasPassword: boolean;
}

export class FileService {
  constructor(
    private readonly repository: FileRepository,
    private readonly telegram: TelegramStorage,
    private readonly maxDownloadSize = 20 * 1024 * 1024,
    private readonly onRollbackError: (error: unknown) => void = () => {},
  ) {}

  async createFolder(input: {
    storageLocationId: bigint;
    parentId: bigint | null;
    name: string;
  }): Promise<FileDto> {
    const name = normalizeName(input.name);
    await this.assertFolder(input.storageLocationId, input.parentId);
    const folder = await this.repository.createFolder({
      storageLocationId: input.storageLocationId,
      parentId: input.parentId,
      name,
    });
    return toFileDto(folder);
  }

  async listFiles(
    storageLocationId: bigint,
    parentId: bigint | null,
    options: FilePageOptions,
  ): Promise<FilePageDto> {
    await this.assertFolder(storageLocationId, parentId);
    const page = await this.repository.listPageByParent(
      storageLocationId,
      parentId,
      options,
    );
    return toFilePageDto(page, options);
  }

  async searchFiles(
    storageLocationId: bigint,
    query: string,
    options: FilePageOptions,
  ): Promise<FilePageDto> {
    const normalized = query.trim();
    if (!normalized) {
      throw new AppError(
        400,
        "INVALID_SEARCH_QUERY",
        "搜索关键词不能为空",
      );
    }
    if (normalized.length > 100) {
      throw new AppError(
        400,
        "SEARCH_QUERY_TOO_LONG",
        "搜索关键词不能超过 100 个字符",
      );
    }

    const page = await this.repository.searchByName(
      storageLocationId,
      normalized,
      options,
    );
    return toFilePageDto(page, options);
  }

  async listTags(): Promise<
    Array<{ slug: string; name: string; color: string }>
  > {
    const tags = await this.repository.listTags();
    return tags.map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      color: tag.color,
    }));
  }

  async listStorageLocations(
    isAdmin: boolean,
  ): Promise<StorageLocationDto[]> {
    const locations = await this.repository.listStorageLocations();
    return locations
      .filter(
        (location) =>
          isAdmin ||
          location.anonymousAccess !== "hidden" ||
          Boolean(location.passwordHash),
      )
      .map(toStorageLocationDto);
  }

  async createStorageLocation(input: {
    name: string;
    anonymousAccess: AnonymousAccess;
    password?: string | null;
  }): Promise<StorageLocationDto> {
    const location = await this.repository.createStorageLocation({
      name: normalizeStorageLocationName(input.name),
      anonymousAccess: input.anonymousAccess,
      passwordHash: input.password
        ? await hashStoragePassword(input.password)
        : null,
    });
    return toStorageLocationDto(location);
  }

  async updateStorageLocation(input: {
    id: bigint;
    name: string;
    anonymousAccess: AnonymousAccess;
    password?: string | null;
  }): Promise<StorageLocationDto> {
    await this.requireStorageLocation(input.id);
    const location = await this.repository.updateStorageLocation({
      id: input.id,
      name: normalizeStorageLocationName(input.name),
      anonymousAccess: input.anonymousAccess,
      ...(input.password !== undefined
        ? {
            passwordHash: input.password
              ? await hashStoragePassword(input.password)
              : null,
          }
        : {}),
    });
    return toStorageLocationDto(location);
  }

  async unlockStorageLocation(
    id: bigint,
    password: string,
  ): Promise<string> {
    const location = await this.requireStorageLocation(id);
    if (
      !location.passwordHash ||
      !(await verifyStoragePassword(password, location.passwordHash))
    ) {
      throw new AppError(
        401,
        "INVALID_STORAGE_PASSWORD",
        "存储位置密码错误",
      );
    }
    return createStorageAccessToken(location.id, location.passwordHash);
  }

  async deleteStorageLocation(id: bigint): Promise<void> {
    await this.requireStorageLocation(id);
    if (await this.repository.countFilesInStorageLocation(id)) {
      throw new AppError(
        409,
        "STORAGE_LOCATION_NOT_EMPTY",
        "只能删除空的存储位置",
      );
    }
    await this.repository.deleteStorageLocation(id);
  }

  async requireStorageAccess(
    id: bigint,
    required: "read" | "write",
    isAdmin: boolean,
    storageToken?: string,
    bypassPassword = isAdmin,
  ): Promise<void> {
    const location = await this.requireStorageLocation(id);
    if (location.passwordHash && !bypassPassword) {
      if (
        !isValidStorageAccessToken(
          storageToken,
          location.id,
          location.passwordHash,
        )
      ) {
        throw new AppError(
          401,
          "STORAGE_PASSWORD_REQUIRED",
          "需要输入存储位置密码",
        );
      }
      if (required === "read") return;
    }
    if (isAdmin) return;
    const allowed =
      location.anonymousAccess === "write" ||
      (required === "read" && location.anonymousAccess === "read");
    if (!allowed) {
      throw new AppError(
        location.anonymousAccess === "hidden" ? 404 : 403,
        location.anonymousAccess === "hidden"
          ? "STORAGE_LOCATION_NOT_FOUND"
          : "STORAGE_LOCATION_FORBIDDEN",
        location.anonymousAccess === "hidden"
          ? "存储位置不存在"
          : "该存储位置不允许匿名写入",
      );
    }
  }

  async listFilesByTag(
    storageLocationId: bigint,
    slug: string,
    options: FilePageOptions,
  ): Promise<FilePageDto> {
    await this.requireTagSlugs([slug]);
    const page = await this.repository.listByTag(
      storageLocationId,
      slug,
      options,
    );
    return toFilePageDto(page, options);
  }

  async setFileTags(
    id: bigint,
    slugs: string[],
    isAdmin = true,
    storageAccessTokens?: Record<string, string>,
    bypassPassword = isAdmin,
  ): Promise<FileDto> {
    // files 表同时承载文件与文件夹；标签适用于两种项目类型。
    const file = await this.requireEntry(id);
    await this.requireStorageAccess(
      file.storageLocationId,
      "write",
      isAdmin,
      storageAccessTokens?.[file.storageLocationId.toString()],
      bypassPassword,
    );
    const uniqueSlugs = [...new Set(slugs)];
    if (uniqueSlugs.length > 8) {
      throw new AppError(
        400,
        "TOO_MANY_TAGS",
        "一个项目最多设置 8 个标签",
      );
    }
    await this.requireTagSlugs(uniqueSlugs);
    await this.repository.replaceTags(id, uniqueSlugs);
    return toFileDto(await this.requireEntry(id));
  }

  async getFile(id: bigint): Promise<FileDto> {
    return toFileDto(await this.requireEntry(id));
  }

  async uploadFile(input: UploadInput): Promise<FileDto> {
    await this.assertFolder(input.storageLocationId, input.parentId);
    const filename = normalizeName(input.filename);
    const extension = getExtension(filename);
    const mimeType = input.mimeType?.slice(0, 100) || null;
    const uploaded = await this.telegram.uploadFile(
      input.stream,
      filename,
      mimeType ?? undefined,
      input.thumbnail,
    );

    if (input.isTruncated?.()) {
      throw new AppError(
        413,
        "FILE_TOO_LARGE",
        "上传文件超过允许的大小",
      );
    }

    const file = await this.repository.createStoredFile({
      storageLocationId: input.storageLocationId,
      parentId: input.parentId,
      name: filename,
      size: uploaded.fileSize,
      mimeType,
      extension,
      contentToken: createContentToken(),
      privateContentToken: createContentToken(),
      telegram: uploaded,
    });
    return toFileDto(file);
  }

  async downloadFile(id: bigint): Promise<DownloadResult> {
    const file = await this.repository.findStoredById(id);
    if (!file) {
      throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
    }
    return this.createFileDownloadResult(file);
  }

  async downloadFileByContentToken(
    contentToken: string,
  ): Promise<DownloadResult> {
    const file = await this.requireStoredFileByContentToken(contentToken);
    return this.createFileDownloadResult(file);
  }

  async downloadThumbnail(id: bigint): Promise<DownloadResult> {
    const file = await this.repository.findStoredById(id);

    if (!file) {
      throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
    }
    return this.createThumbnailDownloadResult(file);
  }

  async downloadThumbnailByContentToken(
    contentToken: string,
  ): Promise<DownloadResult> {
    const file = await this.requireStoredFileByContentToken(contentToken);
    return this.createThumbnailDownloadResult(file);
  }

  async createPrivateContentLinks(
    fileIds: bigint[],
  ): Promise<PrivateContentLinkDto[]> {
    const uniqueIds = [...new Set(fileIds)];
    if (uniqueIds.length === 0 || uniqueIds.length > 100) {
      throw new AppError(
        400,
        "INVALID_PRIVATE_CONTENT_FILES",
        "fileIds 必须包含1到100个文件",
      );
    }

    const links: PrivateContentLinkDto[] = [];
    for (const fileId of uniqueIds) {
      const file = await this.repository.findStoredById(fileId);
      if (!file || file.type !== "file" || !file.telegram) {
        throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
      }
      const location = await this.requireStorageLocation(
        file.storageLocationId,
      );
      if (location.anonymousAccess !== "hidden") {
        throw new AppError(
          400,
          "PRIVATE_CONTENT_NOT_REQUIRED",
          "公开存储位置不需要私有内容链接",
        );
      }
      if (!file.privateContentToken) {
        throw new AppError(
          409,
          "PRIVATE_CONTENT_TOKEN_MISSING",
          "文件缺少私有访问凭证",
        );
      }
      links.push({
        fileId: fileId.toString(),
        token: file.privateContentToken,
      });
    }
    return links;
  }

  async downloadPrivateContent(
    token: string,
    mode: PrivateContentMode,
  ): Promise<DownloadResult> {
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(token)) {
      throw new AppError(404, "PRIVATE_CONTENT_NOT_FOUND", "链接不存在");
    }
    const file =
      await this.repository.findStoredByPrivateContentToken(token);
    if (!file) {
      throw new AppError(404, "PRIVATE_CONTENT_NOT_FOUND", "链接不存在");
    }
    return mode === "thumbnail"
      ? this.createThumbnailDownloadResult(file)
      : this.createFileDownloadResult(file);
  }

  async copyFile(
    id: bigint,
    targetStorageLocationId: bigint,
    targetParentId: bigint | null,
  ): Promise<FileDto> {
    await this.assertFolder(targetStorageLocationId, targetParentId);
    const source = await this.repository.findStoredById(id);

    if (!source) {
      throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
    }
    if (source.type === "folder") {
      await this.assertCopyTarget(source.id, targetParentId);
    }

    const created: CreatedCopy[] = [];
    try {
      const copied = await this.copyEntry(
        source,
        targetStorageLocationId,
        targetParentId,
        created,
      );
      return toFileDto(copied);
    } catch (error) {
      await this.rollbackCopies(created);
      throw error;
    }
  }

  async deleteFile(id: bigint): Promise<void> {
    const file = await this.repository.findById(id);

    if (!file) {
      throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
    }

    await this.softDeleteTree(file);
  }

  private async assertFolder(
    storageLocationId: bigint,
    parentId: bigint | null,
  ): Promise<void> {
    const location = await this.repository.findStorageLocation(
      storageLocationId,
    );
    if (!location) {
      throw new AppError(
        404,
        "STORAGE_LOCATION_NOT_FOUND",
        "存储位置不存在",
      );
    }
    if (parentId === null) {
      return;
    }

    const parent = await this.repository.findById(parentId);
    if (!parent) {
      throw new AppError(404, "PARENT_NOT_FOUND", "父目录不存在");
    }
    if (parent.type !== "folder") {
      throw new AppError(
        400,
        "PARENT_NOT_FOLDER",
        "parentId 指向的资源不是目录",
      );
    }
    if (parent.storageLocationId !== storageLocationId) {
      throw new AppError(
        400,
        "STORAGE_LOCATION_MISMATCH",
        "父目录不属于目标存储位置",
      );
    }
  }

  private async requireEntry(id: bigint): Promise<FileRecord> {
    const file = await this.repository.findById(id);
    if (!file) {
      throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
    }
    return file;
  }

  private async requireStoredFileByContentToken(contentToken: string) {
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(contentToken)) {
      throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
    }
    const file = await this.repository.findStoredByContentToken(
      contentToken,
    );
    if (!file || file.type !== "file") {
      throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
    }
    return file;
  }

  private async createFileDownloadResult(
    file: Awaited<ReturnType<FileRepository["findStoredById"]>> & {},
  ): Promise<DownloadResult> {
    if (file.type !== "file" || !file.telegram) {
      throw new AppError(400, "NOT_A_FILE", "指定资源不是文件");
    }
    const storedSize = file.telegram.fileSize ?? file.size;
    if (storedSize > BigInt(this.maxDownloadSize)) {
      throw new AppError(
        413,
        "DOWNLOAD_FILE_TOO_LARGE",
        `文件超过下载大小限制（${formatFileSize(this.maxDownloadSize)}）`,
      );
    }
    return {
      stream: await this.telegram.downloadFile(
        file.telegram.telegramFileId,
      ),
      filename: file.name,
      mimeType: file.mimeType ?? "application/octet-stream",
      size: file.size,
    };
  }

  private async createThumbnailDownloadResult(
    file: Awaited<ReturnType<FileRepository["findStoredById"]>> & {},
  ): Promise<DownloadResult> {
    if (
      file.type !== "file" ||
      !file.telegram?.thumbnailFileId
    ) {
      throw new AppError(
        404,
        "THUMBNAIL_NOT_FOUND",
        "该文件没有可用的缩略图",
      );
    }
    return {
      stream: await this.telegram.downloadFile(
        file.telegram.thumbnailFileId,
      ),
      filename: `${file.name}.thumbnail.jpg`,
      mimeType: "image/jpeg",
      size: file.telegram.thumbnailFileSize ?? 0n,
    };
  }

  private async requireStorageLocation(id: bigint) {
    const location = await this.repository.findStorageLocation(id);
    if (!location) {
      throw new AppError(
        404,
        "STORAGE_LOCATION_NOT_FOUND",
        "存储位置不存在",
      );
    }
    return location;
  }

  private async requireTagSlugs(slugs: string[]): Promise<void> {
    if (slugs.length === 0) {
      return;
    }
    const tags = await this.repository.listTags();
    const available = new Set(tags.map((tag) => tag.slug));
    const invalid = slugs.find((slug) => !available.has(slug));
    if (invalid) {
      throw new AppError(
        400,
        "INVALID_TAG",
        `标签不存在：${invalid}`,
      );
    }
  }

  private async copyEntry(
    source: Awaited<ReturnType<FileRepository["findStoredById"]>> & {},
    targetStorageLocationId: bigint,
    targetParentId: bigint | null,
    created: CreatedCopy[],
  ): Promise<FileRecord> {
    if (source.type === "folder") {
      const folder = await this.repository.createFolder({
        storageLocationId: targetStorageLocationId,
        parentId: targetParentId,
        name: source.name,
      });
      created.push({ id: folder.id });

      const children = await this.repository.listByParent(source.id);
      for (const child of children) {
        const storedChild = await this.repository.findStoredById(child.id);
        if (!storedChild) {
          throw new AppError(
            409,
            "COPY_SOURCE_MISSING",
            "复制源中的文件不存在",
          );
        }
        await this.copyEntry(
          storedChild,
          targetStorageLocationId,
          folder.id,
          created,
        );
      }
      return folder;
    }

    if (!source.telegram) {
      throw new AppError(
        409,
        "STORAGE_MAPPING_MISSING",
        "文件缺少 Telegram 存储映射",
      );
    }

    const uploaded = {
      chatId: source.telegram.telegramChatId,
      messageId: source.telegram.telegramMessageId,
      fileId: source.telegram.telegramFileId,
      fileUniqueId: source.telegram.telegramFileUniqueId,
      fileSize: source.telegram.fileSize ?? source.size,
      thumbnail: source.telegram.thumbnailFileId
        ? {
            fileId: source.telegram.thumbnailFileId,
            fileUniqueId:
              source.telegram.thumbnailFileUniqueId ?? null,
            width: source.telegram.thumbnailWidth ?? 0,
            height: source.telegram.thumbnailHeight ?? 0,
            fileSize: source.telegram.thumbnailFileSize ?? null,
          }
        : null,
    };

    const file = await this.repository.createStoredFile({
      storageLocationId: targetStorageLocationId,
      parentId: targetParentId,
      name: source.name,
      size: uploaded.fileSize || source.size,
      mimeType: source.mimeType,
      extension: source.extension,
      contentToken: createContentToken(),
      privateContentToken: createContentToken(),
      telegram: uploaded,
    });
    created.push({ id: file.id });
    return file;
  }

  private async assertCopyTarget(
    sourceFolderId: bigint,
    targetParentId: bigint | null,
  ): Promise<void> {
    const visited = new Set<bigint>();
    let currentId = targetParentId;

    while (currentId !== null) {
      if (currentId === sourceFolderId) {
        throw new AppError(
          400,
          "INVALID_COPY_TARGET",
          "不能把文件夹粘贴到自身或其子目录中",
        );
      }
      if (visited.has(currentId)) {
        throw new AppError(
          409,
          "FOLDER_CYCLE",
          "目录结构中存在循环引用",
        );
      }
      visited.add(currentId);
      const current = await this.repository.findById(currentId);
      currentId = current?.parentId ?? null;
    }
  }

  private async rollbackCopies(created: CreatedCopy[]): Promise<void> {
    for (const entry of [...created].reverse()) {
      try {
        await this.repository.softDeleteById(entry.id);
      } catch (rollbackError) {
        this.onRollbackError(rollbackError);
      }
    }
  }

  private async softDeleteTree(file: FileRecord): Promise<void> {
    if (file.type === "folder") {
      const children = await this.repository.listByParent(file.id);
      for (const child of children) {
        await this.softDeleteTree(child);
      }
    }

    await this.repository.softDeleteById(file.id);
  }
}

function formatFileSize(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)} MiB`;
  }
  return `${bytes} 字节`;
}

function toStorageLocationDto(
  location: Awaited<
    ReturnType<FileRepository["findStorageLocation"]>
  > & {},
): StorageLocationDto {
  return {
    id: location.id.toString(),
    name: location.name,
    anonymousAccess: location.anonymousAccess,
    hasPassword: Boolean(location.passwordHash),
  };
}

function normalizeStorageLocationName(value: string): string {
  const name = value.trim();
  if (!name) {
    throw new AppError(
      400,
      "INVALID_STORAGE_LOCATION_NAME",
      "存储位置名称不能为空",
    );
  }
  if (name.length > 50) {
    throw new AppError(
      400,
      "STORAGE_LOCATION_NAME_TOO_LONG",
      "存储位置名称不能超过 50 个字符",
    );
  }
  return name;
}

function toFilePageDto(
  page: FilePage,
  options: FilePageOptions,
): FilePageDto {
  return {
    data: page.items.map(toFileDto),
    pagination: {
      offset: options.offset,
      limit: options.limit,
      total: page.total,
      hasMore: options.offset + page.items.length < page.total,
    },
  };
}

function normalizeName(value: string): string {
  const name = value.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";

  if (!name || name === "." || name === ".." || name.includes("\0")) {
    throw new AppError(400, "INVALID_NAME", "名称无效");
  }
  if ([...name].length > 255) {
    throw new AppError(400, "NAME_TOO_LONG", "名称不能超过 255 个字符");
  }

  return name;
}

function createContentToken(): string {
  return randomBytes(16).toString("base64url");
}

async function hashStoragePassword(password: string): Promise<string> {
  validateStoragePassword(password);
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 32);
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

async function verifyStoragePassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, saltText, hashText] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    const actual = await scryptAsync(password, salt, expected.length);
    return expected.length === actual.length &&
      timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function validateStoragePassword(password: string): void {
  if (password.length < 4 || password.length > 128) {
    throw new AppError(
      400,
      "INVALID_STORAGE_PASSWORD",
      "存储位置密码长度必须在 4 到 128 个字符之间",
    );
  }
}

function createStorageAccessToken(
  id: bigint,
  passwordHash: string,
): string {
  return createHmac("sha256", passwordHash)
    .update(`storage-location:${id}`)
    .digest("base64url");
}

function isValidStorageAccessToken(
  token: string | undefined,
  id: bigint,
  passwordHash: string,
): boolean {
  if (!token) return false;
  const expected = Buffer.from(
    createStorageAccessToken(id, passwordHash),
  );
  const actual = Buffer.from(token);
  return expected.length === actual.length &&
    timingSafeEqual(expected, actual);
}

function getExtension(filename: string): string | null {
  const extension = extname(filename).slice(1).toLowerCase();
  return extension && extension.length <= 20 ? extension : null;
}

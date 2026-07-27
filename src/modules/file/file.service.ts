import { extname } from "node:path";
import type { Readable } from "node:stream";
import { AppError } from "../../utils/app-error.js";
import type {
  FileDto,
  FileRecord,
  FileRepository,
  TelegramStorage,
} from "./file.types.js";
import { toFileDto } from "./file.types.js";

export interface UploadInput {
  parentId: bigint | null;
  filename: string;
  mimeType: string | null;
  stream: Readable;
  isTruncated?: () => boolean;
}

export interface DownloadResult {
  stream: Readable;
  filename: string;
  mimeType: string;
  size: bigint;
}

interface CreatedCopy {
  id: bigint;
}

export class FileService {
  constructor(
    private readonly repository: FileRepository,
    private readonly telegram: TelegramStorage,
    private readonly onRollbackError: (error: unknown) => void = () => {},
  ) {}

  async createFolder(input: {
    parentId: bigint | null;
    name: string;
  }): Promise<FileDto> {
    const name = normalizeName(input.name);
    await this.assertFolder(input.parentId);
    const folder = await this.repository.createFolder({
      parentId: input.parentId,
      name,
    });
    return toFileDto(folder);
  }

  async listFiles(parentId: bigint | null): Promise<FileDto[]> {
    await this.assertFolder(parentId);
    const files = await this.repository.listByParent(parentId);
    return files.map(toFileDto);
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

  async listFilesByTag(slug: string): Promise<FileDto[]> {
    await this.requireTagSlugs([slug]);
    const files = await this.repository.listByTag(slug);
    return files.map(toFileDto);
  }

  async setFileTags(id: bigint, slugs: string[]): Promise<FileDto> {
    await this.requireFile(id);
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
    return toFileDto(await this.requireFile(id));
  }

  async getFile(id: bigint): Promise<FileDto> {
    return toFileDto(await this.requireFile(id));
  }

  async uploadFile(input: UploadInput): Promise<FileDto> {
    await this.assertFolder(input.parentId);
    const filename = normalizeName(input.filename);
    const extension = getExtension(filename);
    const mimeType = input.mimeType?.slice(0, 100) || null;
    const uploaded = await this.telegram.uploadFile(
      input.stream,
      filename,
      mimeType ?? undefined,
    );

    if (input.isTruncated?.()) {
      throw new AppError(
        413,
        "FILE_TOO_LARGE",
        "上传文件超过允许的大小",
      );
    }

    const file = await this.repository.createStoredFile({
      parentId: input.parentId,
      name: filename,
      size: uploaded.fileSize,
      mimeType,
      extension,
      telegram: uploaded,
    });
    return toFileDto(file);
  }

  async downloadFile(id: bigint): Promise<DownloadResult> {
    const file = await this.repository.findStoredById(id);

    if (!file) {
      throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
    }
    if (file.type !== "file" || !file.telegram) {
      throw new AppError(400, "NOT_A_FILE", "指定资源不是文件");
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

  async copyFile(
    id: bigint,
    targetParentId: bigint | null,
  ): Promise<FileDto> {
    await this.assertFolder(targetParentId);
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

  private async assertFolder(parentId: bigint | null): Promise<void> {
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
  }

  private async requireFile(id: bigint): Promise<FileRecord> {
    const file = await this.repository.findById(id);
    if (!file) {
      throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
    }
    return file;
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
    targetParentId: bigint | null,
    created: CreatedCopy[],
  ): Promise<FileRecord> {
    if (source.type === "folder") {
      const folder = await this.repository.createFolder({
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
        await this.copyEntry(storedChild, folder.id, created);
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
    };

    const file = await this.repository.createStoredFile({
      parentId: targetParentId,
      name: source.name,
      size: uploaded.fileSize || source.size,
      mimeType: source.mimeType,
      extension: source.extension,
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

function getExtension(filename: string): string | null {
  const extension = extname(filename).slice(1).toLowerCase();
  return extension && extension.length <= 20 ? extension : null;
}

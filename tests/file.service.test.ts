import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { FileService } from "../src/modules/file/file.service.js";
import type {
  FilePage,
  FilePageOptions,
  FileRecord,
  FileRepository,
  StorageLocationRecord,
  StoredFileRecord,
  TagRecord,
  TelegramStorage,
  TelegramUploadResult,
} from "../src/modules/file/file.types.js";

const now = new Date("2026-07-27T00:00:00.000Z");
const firstPage: FilePageOptions = {
  offset: 0,
  limit: 50,
  sortBy: "name",
  sortOrder: "asc",
};

function record(
  overrides: Partial<FileRecord> & Pick<FileRecord, "id" | "name" | "type">,
): FileRecord {
  return {
    storageLocationId: 1n,
    parentId: null,
    size: 0n,
    mimeType: null,
    extension: null,
    contentToken: null,
    privateContentToken: null,
    createdAt: now,
    updatedAt: now,
    tags: [],
    hasThumbnail: false,
    ...overrides,
  };
}

class MemoryRepository implements FileRepository {
  files = new Map<bigint, StoredFileRecord>();
  deleted = new Set<bigint>();
  nextId = 1n;
  failCreate = false;
  storageLocations = new Map<bigint, StorageLocationRecord>([
    [
      1n,
      {
        id: 1n,
        name: "TGFS",
        anonymousAccess: "write",
        passwordHash: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  ]);
  availableTags: TagRecord[] = [
    {
      id: 1n,
      slug: "red",
      name: "红色",
      color: "#ef4444",
      sortOrder: 1,
    },
    {
      id: 2n,
      slug: "blue",
      name: "蓝色",
      color: "#3b82f6",
      sortOrder: 5,
    },
  ];

  async findById(id: bigint): Promise<FileRecord | null> {
    if (this.deleted.has(id)) return null;
    return this.files.get(id) ?? null;
  }

  async findStoredById(id: bigint): Promise<StoredFileRecord | null> {
    if (this.deleted.has(id)) return null;
    return this.files.get(id) ?? null;
  }

  async findStoredByContentToken(
    contentToken: string,
  ): Promise<StoredFileRecord | null> {
    return [...this.files.values()].find(
      (file) =>
        file.contentToken === contentToken &&
        !this.deleted.has(file.id),
    ) ?? null;
  }

  async findStoredByPrivateContentToken(
    privateContentToken: string,
  ): Promise<StoredFileRecord | null> {
    return [...this.files.values()].find(
      (file) =>
        file.privateContentToken === privateContentToken &&
        !this.deleted.has(file.id),
    ) ?? null;
  }

  async listByParent(parentId: bigint | null): Promise<FileRecord[]> {
    return [...this.files.values()].filter(
      (file) =>
        file.parentId === parentId && !this.deleted.has(file.id),
    );
  }

  async listPageByParent(
    storageLocationId: bigint,
    parentId: bigint | null,
    options: FilePageOptions,
  ): Promise<FilePage> {
    return this.paginate(
      [...this.files.values()].filter(
        (file) =>
          file.storageLocationId === storageLocationId &&
          file.parentId === parentId &&
          !this.deleted.has(file.id),
      ),
      options,
    );
  }

  async searchByName(
    storageLocationId: bigint,
    query: string,
    options: FilePageOptions,
  ): Promise<FilePage> {
    const normalized = query.toLowerCase();
    return this.paginate(
      [...this.files.values()].filter(
        (file) =>
          file.storageLocationId === storageLocationId &&
          !this.deleted.has(file.id) &&
          file.name.toLowerCase().includes(normalized),
      ),
      options,
    );
  }

  async listByTag(
    storageLocationId: bigint,
    slug: string,
    options: FilePageOptions,
  ): Promise<FilePage> {
    return this.paginate([...this.files.values()].filter(
      (file) =>
        file.storageLocationId === storageLocationId &&
        !this.deleted.has(file.id) &&
        file.tags.some((tag) => tag.slug === slug),
    ), options);
  }

  async listTags(): Promise<TagRecord[]> {
    return this.availableTags;
  }

  async replaceTags(
    fileId: bigint,
    slugs: string[],
  ): Promise<TagRecord[]> {
    const tags = this.availableTags.filter((tag) =>
      slugs.includes(tag.slug),
    );
    const file = this.files.get(fileId);
    if (file) {
      file.tags = tags;
    }
    return tags;
  }

  async listStorageLocations() {
    return [...this.storageLocations.values()];
  }

  async findStorageLocation(id: bigint) {
    return this.storageLocations.get(id) ?? null;
  }

  async createStorageLocation(input: {
    name: string;
    anonymousAccess: "hidden" | "read" | "write";
    passwordHash?: string | null;
  }) {
    const location = {
      id: BigInt(this.storageLocations.size + 1),
      ...input,
      passwordHash: input.passwordHash ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.storageLocations.set(location.id, location);
    return location;
  }

  async updateStorageLocation(input: {
    id: bigint;
    name: string;
    anonymousAccess: "hidden" | "read" | "write";
    passwordHash?: string | null;
  }) {
    const location = {
      ...this.storageLocations.get(input.id)!,
      ...input,
      updatedAt: now,
    };
    this.storageLocations.set(input.id, location);
    return location;
  }

  async deleteStorageLocation(id: bigint): Promise<void> {
    this.storageLocations.delete(id);
  }

  async countFilesInStorageLocation(id: bigint): Promise<number> {
    return [...this.files.values()].filter(
      (file) =>
        file.storageLocationId === id && !this.deleted.has(file.id),
    ).length;
  }

  async createFolder(input: {
    storageLocationId: bigint;
    parentId: bigint | null;
    name: string;
  }): Promise<FileRecord> {
    const folder = record({
      id: this.nextId++,
      storageLocationId: input.storageLocationId,
      parentId: input.parentId,
      name: input.name,
      type: "folder",
    });
    this.files.set(folder.id, { ...folder, telegram: null });
    return folder;
  }

  async createStoredFile(
    input: Parameters<FileRepository["createStoredFile"]>[0],
  ): Promise<FileRecord> {
    if (this.failCreate) {
      throw new Error("database failed");
    }

    const file = record({
      id: this.nextId++,
      storageLocationId: input.storageLocationId,
      parentId: input.parentId,
      name: input.name,
      type: "file",
      size: input.size,
      mimeType: input.mimeType,
      extension: input.extension,
      contentToken: input.contentToken,
      privateContentToken: input.privateContentToken,
      hasThumbnail: Boolean(input.telegram.thumbnail?.fileId),
    });
    this.files.set(file.id, {
      ...file,
      telegram: {
        telegramChatId: input.telegram.chatId,
        telegramMessageId: input.telegram.messageId,
        telegramFileId: input.telegram.fileId,
        telegramFileUniqueId: input.telegram.fileUniqueId,
        fileSize: input.telegram.fileSize,
        thumbnailFileId: input.telegram.thumbnail?.fileId ?? null,
        thumbnailFileUniqueId:
          input.telegram.thumbnail?.fileUniqueId ?? null,
        thumbnailWidth: input.telegram.thumbnail?.width ?? null,
        thumbnailHeight: input.telegram.thumbnail?.height ?? null,
        thumbnailFileSize:
          input.telegram.thumbnail?.fileSize ?? null,
      },
    });
    return file;
  }

  async softDeleteById(id: bigint): Promise<void> {
    this.deleted.add(id);
  }

  private paginate(
    source: StoredFileRecord[],
    options: FilePageOptions,
  ): FilePage {
    const direction = options.sortOrder === "asc" ? 1 : -1;
    const sorted = [...source].sort((left, right) => {
      if (options.sortBy === "name" && left.type !== right.type) {
        return left.type === "folder" ? -1 : 1;
      }
      let compared = 0;
      if (options.sortBy === "name") {
        compared = left.name.localeCompare(right.name);
      } else if (options.sortBy === "updatedAt") {
        compared = left.updatedAt.getTime() - right.updatedAt.getTime();
      } else {
        compared = left.size < right.size
          ? -1
          : left.size > right.size
            ? 1
            : 0;
      }
      return compared === 0
        ? Number(left.id - right.id)
        : compared * direction;
    });
    return {
      items: sorted.slice(
        options.offset,
        options.offset + options.limit,
      ),
      total: sorted.length,
    };
  }
}

class FakeTelegram implements TelegramStorage {
  uploadFile = vi.fn(
    async (): Promise<TelegramUploadResult> => ({
      chatId: -100123n,
      messageId: 99n,
      fileId: "telegram-file",
      fileUniqueId: "unique-file",
      fileSize: 5n,
    }),
  );
  downloadFile = vi.fn(async () => Readable.from(["hello"]));
}

describe("FileService", () => {
  it("按匿名权限隐藏存储位置并限制只读位置写入", async () => {
    const repository = new MemoryRepository();
    await repository.createStorageLocation({
      name: "私密空间",
      anonymousAccess: "hidden",
    });
    const readOnly = await repository.createStorageLocation({
      name: "资料盘",
      anonymousAccess: "read",
    });
    const service = new FileService(repository, new FakeTelegram());

    const anonymousLocations =
      await service.listStorageLocations(false);
    const adminLocations = await service.listStorageLocations(true);

    expect(anonymousLocations.map((item) => item.name)).toEqual([
      "TGFS",
      "资料盘",
    ]);
    expect(adminLocations).toHaveLength(3);
    await expect(
      service.requireStorageAccess(readOnly.id, "write", false),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "STORAGE_LOCATION_FORBIDDEN",
    });
    await expect(
      service.requireStorageAccess(readOnly.id, "read", false),
    ).resolves.toBeUndefined();
  });

  it("密码保护的存储位置必须解锁且修改密码会使旧令牌失效", async () => {
    const repository = new MemoryRepository();
    const service = new FileService(repository, new FakeTelegram());
    const protectedLocation = await service.createStorageLocation({
      name: "加密资料",
      anonymousAccess: "read",
      password: "rice-1234",
    });

    expect(await service.listStorageLocations(false)).toContainEqual(
      expect.objectContaining({
        id: protectedLocation.id,
        hasPassword: true,
      }),
    );
    await expect(
      service.requireStorageAccess(
        BigInt(protectedLocation.id),
        "read",
        false,
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "STORAGE_PASSWORD_REQUIRED",
    });
    await expect(
      service.unlockStorageLocation(
        BigInt(protectedLocation.id),
        "wrong-password",
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_STORAGE_PASSWORD",
    });

    const oldToken = await service.unlockStorageLocation(
      BigInt(protectedLocation.id),
      "rice-1234",
    );
    await expect(
      service.requireStorageAccess(
        BigInt(protectedLocation.id),
        "read",
        false,
        oldToken,
      ),
    ).resolves.toBeUndefined();

    await service.updateStorageLocation({
      id: BigInt(protectedLocation.id),
      name: "加密资料",
      anonymousAccess: "read",
      password: "rice-5678",
    });
    await expect(
      service.requireStorageAccess(
        BigInt(protectedLocation.id),
        "read",
        false,
        oldToken,
      ),
    ).rejects.toMatchObject({
      code: "STORAGE_PASSWORD_REQUIRED",
    });
  });

  it("隐藏存储位置不能设置或保留访问密码", async () => {
    const repository = new MemoryRepository();
    const service = new FileService(repository, new FakeTelegram());

    await expect(
      service.createStorageLocation({
        name: "私密空间",
        anonymousAccess: "hidden",
        password: "rice-1234",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "STORAGE_PASSWORD_NOT_ALLOWED",
    });

    const protectedLocation = await service.createStorageLocation({
      name: "资料盘",
      anonymousAccess: "read",
      password: "rice-1234",
    });
    await expect(
      service.updateStorageLocation({
        id: BigInt(protectedLocation.id),
        name: "资料盘",
        anonymousAccess: "hidden",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "STORAGE_PASSWORD_NOT_ALLOWED",
    });
    await expect(
      service.updateStorageLocation({
        id: BigInt(protectedLocation.id),
        name: "资料盘",
        anonymousAccess: "hidden",
        password: null,
      }),
    ).resolves.toMatchObject({
      hasPassword: false,
    });
  });

  it("匿名只读位置不能修改标签，可写位置可以修改", async () => {
    const repository = new MemoryRepository();
    const service = new FileService(repository, new FakeTelegram());
    repository.files.set(1n, {
      ...record({
        id: 1n,
        name: "说明.txt",
        type: "file",
        tags: [repository.availableTags[0]!],
      }),
      telegram: null,
    });

    repository.storageLocations.get(1n)!.anonymousAccess = "read";
    await expect(
      service.setFileTags(1n, ["blue"], false),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "STORAGE_LOCATION_FORBIDDEN",
    });

    repository.storageLocations.get(1n)!.anonymousAccess = "write";
    await expect(
      service.setFileTags(1n, ["blue"], false),
    ).resolves.toMatchObject({
      tags: [{ slug: "blue" }],
    });
    await expect(
      service.setFileTags(1n, ["red"], true),
    ).resolves.toMatchObject({
      tags: [{ slug: "red" }],
    });
  });

  it("只允许删除空存储位置", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "保留.txt", type: "file" }),
      telegram: null,
    });
    const service = new FileService(repository, new FakeTelegram());

    await expect(service.deleteStorageLocation(1n)).rejects.toMatchObject({
      statusCode: 409,
      code: "STORAGE_LOCATION_NOT_EMPTY",
    });
  });

  it("在请求 Telegram 前拒绝超过下载限制的文件", async () => {
    const repository = new MemoryRepository();
    const telegram = new FakeTelegram();
    repository.files.set(1n, {
      ...record({
        id: 1n,
        name: "large.bin",
        type: "file",
        size: 21n,
        mimeType: "application/octet-stream",
      }),
      telegram: {
        telegramChatId: -100123n,
        telegramMessageId: 99n,
        telegramFileId: "large-telegram-file",
        telegramFileUniqueId: "large-unique-file",
        fileSize: 21n,
      },
    });
    const service = new FileService(repository, telegram, 20);

    await expect(service.downloadFile(1n)).rejects.toMatchObject({
      statusCode: 413,
      code: "DOWNLOAD_FILE_TOO_LARGE",
      message: "文件超过下载大小限制（20 字节）",
    });
    expect(telegram.downloadFile).not.toHaveBeenCalled();
  });

  it("为隐藏文件返回永久私有链接并允许内容读取", async () => {
    const repository = new MemoryRepository();
    const telegram = new FakeTelegram();
    repository.storageLocations.get(1n)!.anonymousAccess = "hidden";
    repository.files.set(1n, {
      ...record({
        id: 1n,
        name: "hidden.png",
        type: "file",
        size: 5n,
        mimeType: "image/png",
        contentToken: "publicabcdefghijklmnop",
        privateContentToken: "privateabcdefghijklmno",
      }),
      telegram: {
        telegramChatId: -100123n,
        telegramMessageId: 99n,
        telegramFileId: "hidden-telegram-file",
        telegramFileUniqueId: "hidden-unique-file",
        fileSize: 5n,
      },
    });
    const service = new FileService(repository, telegram);

    const first = await service.createPrivateContentLinks([1n]);
    const second = await service.createPrivateContentLinks([1n]);

    expect(first[0]?.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(second[0]?.token).toBe(first[0]?.token);
    const downloaded = await service.downloadPrivateContent(
      first[0]!.token,
      "preview",
    );
    expect(downloaded.filename).toBe("hidden.png");
    expect(telegram.downloadFile).toHaveBeenCalledWith(
      "hidden-telegram-file",
    );

    const publicDownload = await service.downloadFileByContentToken(
      "publicabcdefghijklmnop",
    );
    expect(publicDownload.filename).toBe("hidden.png");
  });

  it("创建目录并把 BigInt 安全转换为字符串", async () => {
    const repository = new MemoryRepository();
    const service = new FileService(repository, new FakeTelegram());

    const folder = await service.createFolder({
      storageLocationId: 1n,
      parentId: null,
      name: "docs",
    });

    expect(folder).toMatchObject({
      id: "1",
      parentId: null,
      name: "docs",
      type: "folder",
      size: "0",
    });
  });

  it("拒绝把文件用作父目录", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "x.txt", type: "file" }),
      telegram: null,
    });
    const service = new FileService(repository, new FakeTelegram());

    await expect(
      service.createFolder({
        storageLocationId: 1n,
        parentId: 1n,
        name: "child",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "PARENT_NOT_FOLDER",
    });
  });

  it("分页搜索全部目录中的未删除项目", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "项目", type: "folder" }),
      telegram: null,
    });
    repository.files.set(2n, {
      ...record({
        id: 2n,
        parentId: 1n,
        name: "年度报告.pdf",
        type: "file",
      }),
      telegram: null,
    });
    repository.files.set(3n, {
      ...record({
        id: 3n,
        name: "旧报告.pdf",
        type: "file",
      }),
      telegram: null,
    });
    repository.deleted.add(3n);
    const service = new FileService(repository, new FakeTelegram());

    const page = await service.searchFiles(1n, " 报告 ", {
      ...firstPage,
      limit: 1,
    });

    expect(page.data.map((file) => file.id)).toEqual(["2"]);
    expect(page.pagination).toEqual({
      offset: 0,
      limit: 1,
      total: 1,
      hasMore: false,
    });
  });

  it("目录列表按指定顺序分页并返回是否有下一页", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "a.txt", type: "file", size: 1n }),
      telegram: null,
    });
    repository.files.set(2n, {
      ...record({ id: 2n, name: "b.txt", type: "file", size: 2n }),
      telegram: null,
    });
    const service = new FileService(repository, new FakeTelegram());

    const page = await service.listFiles(1n, null, {
      ...firstPage,
      limit: 1,
      sortBy: "size",
      sortOrder: "desc",
    });

    expect(page.data.map((file) => file.name)).toEqual(["b.txt"]);
    expect(page.pagination).toEqual({
      offset: 0,
      limit: 1,
      total: 2,
      hasMore: true,
    });
  });

  it("拒绝空的全局搜索关键词", async () => {
    const service = new FileService(
      new MemoryRepository(),
      new FakeTelegram(),
    );

    await expect(
      service.searchFiles(1n, "   ", firstPage),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_SEARCH_QUERY",
    });
  });

  it("流式上传到 Telegram 后保存元数据", async () => {
    const repository = new MemoryRepository();
    const telegram = new FakeTelegram();
    const service = new FileService(repository, telegram);
    const stream = Readable.from(["hello"]);

    const file = await service.uploadFile({
      storageLocationId: 1n,
      parentId: null,
      filename: "../hello.TXT",
      mimeType: "text/plain",
      stream,
    });

    expect(telegram.uploadFile).toHaveBeenCalledWith(
      stream,
      "hello.TXT",
      "text/plain",
      undefined,
    );
    expect(file).toMatchObject({
      name: "hello.TXT",
      extension: "txt",
      size: "5",
      hasThumbnail: false,
    });
    expect(file.contentToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(file).not.toHaveProperty("privateContentToken");
    expect(
      repository.files.get(1n)?.privateContentToken,
    ).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(repository.files.get(1n)?.privateContentToken).not.toBe(
      file.contentToken,
    );

    const downloaded = await service.downloadFileByContentToken(
      file.contentToken!,
    );
    expect(downloaded.filename).toBe("hello.TXT");
    expect(telegram.downloadFile).toHaveBeenCalledWith("telegram-file");
  });

  it("上传并保存 Telegram 返回的图片缩略图", async () => {
    const repository = new MemoryRepository();
    const telegram = new FakeTelegram();
    telegram.uploadFile.mockResolvedValueOnce({
      chatId: -100123n,
      messageId: 99n,
      fileId: "image-file",
      fileUniqueId: "image-unique",
      fileSize: 1024n,
      thumbnail: {
        fileId: "thumbnail-file",
        fileUniqueId: "thumbnail-unique",
        width: 320,
        height: 180,
        fileSize: 12_345n,
      },
    });
    const service = new FileService(repository, telegram);
    const thumbnail = Buffer.from("jpeg-thumbnail");

    const file = await service.uploadFile({
      storageLocationId: 1n,
      parentId: null,
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      stream: Readable.from(["image"]),
      thumbnail,
    });

    expect(telegram.uploadFile).toHaveBeenCalledWith(
      expect.any(Readable),
      "photo.jpg",
      "image/jpeg",
      thumbnail,
    );
    expect(file.hasThumbnail).toBe(true);
    expect(repository.files.get(1n)?.telegram).toMatchObject({
      thumbnailFileId: "thumbnail-file",
      thumbnailWidth: 320,
      thumbnailHeight: 180,
      thumbnailFileSize: 12_345n,
    });

    const result = await service.downloadThumbnail(1n);
    expect(result).toMatchObject({
      filename: "photo.jpg.thumbnail.jpg",
      mimeType: "image/jpeg",
      size: 12_345n,
    });
    expect(telegram.downloadFile).toHaveBeenCalledWith(
      "thumbnail-file",
    );
  });

  it("数据库写入失败时保留已上传的 Telegram 内容", async () => {
    const repository = new MemoryRepository();
    repository.failCreate = true;
    const telegram = new FakeTelegram();
    const service = new FileService(repository, telegram);

    await expect(
      service.uploadFile({
        storageLocationId: 1n,
        parentId: null,
        filename: "hello.txt",
        mimeType: "text/plain",
        stream: Readable.from(["hello"]),
      }),
    ).rejects.toThrow("database failed");

    expect(telegram.uploadFile).toHaveBeenCalledOnce();
    expect(repository.files.size).toBe(0);
  });

  it("上传流被截断时保留 Telegram 内容且不写数据库", async () => {
    const repository = new MemoryRepository();
    const telegram = new FakeTelegram();
    const service = new FileService(repository, telegram);

    await expect(
      service.uploadFile({
        storageLocationId: 1n,
        parentId: null,
        filename: "large.bin",
        mimeType: "application/octet-stream",
        stream: Readable.from(["partial"]),
        isTruncated: () => true,
      }),
    ).rejects.toMatchObject({
      statusCode: 413,
      code: "FILE_TOO_LARGE",
    });

    expect(repository.files.size).toBe(0);
    expect(telegram.uploadFile).toHaveBeenCalledOnce();
  });

  it("复用原 Telegram 映射复制文件到目标目录", async () => {
    const repository = new MemoryRepository();
    const telegram = new FakeTelegram();
    const source = record({
      id: 1n,
      name: "hello.txt",
      type: "file",
      size: 5n,
      mimeType: "text/plain",
      extension: "txt",
      tags: [repository.availableTags[0]!],
    });
    repository.files.set(1n, {
      ...source,
      telegram: {
        telegramChatId: -100123n,
        telegramMessageId: 99n,
        telegramFileId: "telegram-file",
        telegramFileUniqueId: "unique-file",
        fileSize: 5n,
      },
    });
    repository.nextId = 2n;
    const service = new FileService(repository, telegram);

    const copied = await service.copyFile(1n, 1n, null);

    expect(telegram.uploadFile).not.toHaveBeenCalled();
    expect(copied).toMatchObject({
      id: "2",
      name: "hello.txt",
      size: "5",
    });
    expect(copied.contentToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(
      repository.files.get(2n)?.privateContentToken,
    ).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(repository.files.get(2n)?.telegram).toMatchObject(
      repository.files.get(1n)?.telegram ?? {},
    );
    expect(repository.files.get(2n)?.tags).toEqual([]);
  });

  it("拒绝把文件夹复制到自身的子目录", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "parent", type: "folder" }),
      telegram: null,
    });
    repository.files.set(2n, {
      ...record({
        id: 2n,
        parentId: 1n,
        name: "child",
        type: "folder",
      }),
      telegram: null,
    });
    const service = new FileService(repository, new FakeTelegram());

    await expect(service.copyFile(1n, 1n, 2n)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_COPY_TARGET",
    });
  });

  it("递归复制文件夹及其中的文件", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "docs", type: "folder" }),
      telegram: null,
    });
    repository.files.set(2n, {
      ...record({
        id: 2n,
        parentId: 1n,
        name: "readme.txt",
        type: "file",
        size: 5n,
      }),
      telegram: {
        telegramChatId: -100123n,
        telegramMessageId: 99n,
        telegramFileId: "telegram-file",
        telegramFileUniqueId: "unique-file",
        fileSize: 5n,
      },
    });
    repository.nextId = 3n;
    const telegram = new FakeTelegram();
    const service = new FileService(repository, telegram);

    const copiedFolder = await service.copyFile(1n, 1n, null);
    const copiedChildren = await repository.listByParent(
      BigInt(copiedFolder.id),
    );

    expect(copiedFolder).toMatchObject({
      id: "3",
      name: "docs",
      type: "folder",
    });
    expect(copiedChildren).toHaveLength(1);
    expect(copiedChildren[0]).toMatchObject({
      name: "readme.txt",
      parentId: 3n,
      type: "file",
      tags: [],
    });
  });

  it("允许文件设置标签并按标签筛选", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "tagged.txt", type: "file" }),
      telegram: null,
    });
    const service = new FileService(repository, new FakeTelegram());

    const tagged = await service.setFileTags(1n, ["red", "blue"]);
    const redFiles = await service.listFilesByTag(
      1n,
      "red",
      firstPage,
    );

    expect(tagged.tags.map((tag) => tag.slug)).toEqual([
      "red",
      "blue",
    ]);
    expect(redFiles.data).toHaveLength(1);
    expect(redFiles.data[0]?.id).toBe("1");
  });

  it("允许文件夹设置标签并出现在标签筛选结果中", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "设计资料", type: "folder" }),
      telegram: null,
    });
    const service = new FileService(repository, new FakeTelegram());

    const taggedFolder = await service.setFileTags(1n, ["red"]);
    const taggedItems = await service.listFilesByTag(
      1n,
      "red",
      firstPage,
    );

    expect(taggedFolder).toMatchObject({
      id: "1",
      name: "设计资料",
      type: "folder",
      tags: [{ slug: "red", name: "红色", color: "#ef4444" }],
    });
    expect(taggedItems.data).toEqual([
      expect.objectContaining({
        id: "1",
        type: "folder",
      }),
    ]);
  });

  it("递归软删除非空目录并保留 Telegram 映射", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "docs", type: "folder" }),
      telegram: null,
    });
    repository.files.set(2n, {
      ...record({
        id: 2n,
        parentId: 1n,
        name: "child.txt",
        type: "file",
      }),
      telegram: {
        telegramChatId: -100123n,
        telegramMessageId: 99n,
        telegramFileId: "telegram-file",
        telegramFileUniqueId: "unique-file",
        fileSize: 5n,
      },
    });
    const service = new FileService(repository, new FakeTelegram());

    await service.deleteFile(1n);

    expect(repository.deleted).toEqual(new Set([1n, 2n]));
    expect(repository.files.size).toBe(2);
    expect(repository.files.get(2n)?.telegram).toMatchObject({
      telegramFileId: "telegram-file",
      telegramMessageId: 99n,
    });
    expect(await repository.listByParent(null)).toEqual([]);
  });
});

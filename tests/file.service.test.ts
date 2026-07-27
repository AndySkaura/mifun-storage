import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { FileService } from "../src/modules/file/file.service.js";
import type {
  FileRecord,
  FileRepository,
  StoredFileRecord,
  TagRecord,
  TelegramStorage,
  TelegramUploadResult,
} from "../src/modules/file/file.types.js";

const now = new Date("2026-07-27T00:00:00.000Z");

function record(
  overrides: Partial<FileRecord> & Pick<FileRecord, "id" | "name" | "type">,
): FileRecord {
  return {
    parentId: null,
    size: 0n,
    mimeType: null,
    extension: null,
    createdAt: now,
    updatedAt: now,
    tags: [],
    ...overrides,
  };
}

class MemoryRepository implements FileRepository {
  files = new Map<bigint, StoredFileRecord>();
  deleted = new Set<bigint>();
  nextId = 1n;
  failCreate = false;
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

  async listByParent(parentId: bigint | null): Promise<FileRecord[]> {
    return [...this.files.values()].filter(
      (file) =>
        file.parentId === parentId && !this.deleted.has(file.id),
    );
  }

  async listByTag(slug: string): Promise<FileRecord[]> {
    return [...this.files.values()].filter(
      (file) =>
        !this.deleted.has(file.id) &&
        file.tags.some((tag) => tag.slug === slug),
    );
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

  async createFolder(input: {
    parentId: bigint | null;
    name: string;
  }): Promise<FileRecord> {
    const folder = record({
      id: this.nextId++,
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
      parentId: input.parentId,
      name: input.name,
      type: "file",
      size: input.size,
      mimeType: input.mimeType,
      extension: input.extension,
    });
    this.files.set(file.id, {
      ...file,
      telegram: {
        telegramChatId: input.telegram.chatId,
        telegramMessageId: input.telegram.messageId,
        telegramFileId: input.telegram.fileId,
        telegramFileUniqueId: input.telegram.fileUniqueId,
        fileSize: input.telegram.fileSize,
      },
    });
    return file;
  }

  async softDeleteById(id: bigint): Promise<void> {
    this.deleted.add(id);
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
  it("创建目录并把 BigInt 安全转换为字符串", async () => {
    const repository = new MemoryRepository();
    const service = new FileService(repository, new FakeTelegram());

    const folder = await service.createFolder({
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
      service.createFolder({ parentId: 1n, name: "child" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "PARENT_NOT_FOLDER",
    });
  });

  it("流式上传到 Telegram 后保存元数据", async () => {
    const repository = new MemoryRepository();
    const telegram = new FakeTelegram();
    const service = new FileService(repository, telegram);
    const stream = Readable.from(["hello"]);

    const file = await service.uploadFile({
      parentId: null,
      filename: "../hello.TXT",
      mimeType: "text/plain",
      stream,
    });

    expect(telegram.uploadFile).toHaveBeenCalledWith(
      stream,
      "hello.TXT",
      "text/plain",
    );
    expect(file).toMatchObject({
      name: "hello.TXT",
      extension: "txt",
      size: "5",
    });
  });

  it("数据库写入失败时保留已上传的 Telegram 内容", async () => {
    const repository = new MemoryRepository();
    repository.failCreate = true;
    const telegram = new FakeTelegram();
    const service = new FileService(repository, telegram);

    await expect(
      service.uploadFile({
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

    const copied = await service.copyFile(1n, null);

    expect(telegram.uploadFile).not.toHaveBeenCalled();
    expect(copied).toMatchObject({
      id: "2",
      name: "hello.txt",
      size: "5",
    });
    expect(repository.files.get(2n)?.telegram).toEqual(
      repository.files.get(1n)?.telegram,
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

    await expect(service.copyFile(1n, 2n)).rejects.toMatchObject({
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

    const copiedFolder = await service.copyFile(1n, null);
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

  it("设置标签并按标签筛选文件", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "tagged.txt", type: "file" }),
      telegram: null,
    });
    const service = new FileService(repository, new FakeTelegram());

    const tagged = await service.setFileTags(1n, ["red", "blue"]);
    const redFiles = await service.listFilesByTag("red");

    expect(tagged.tags.map((tag) => tag.slug)).toEqual([
      "red",
      "blue",
    ]);
    expect(redFiles).toHaveLength(1);
    expect(redFiles[0]?.id).toBe("1");
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

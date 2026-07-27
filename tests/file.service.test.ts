import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { FileService } from "../src/modules/file/file.service.js";
import type {
  FileRecord,
  FileRepository,
  StoredFileRecord,
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
    ...overrides,
  };
}

class MemoryRepository implements FileRepository {
  files = new Map<bigint, StoredFileRecord>();
  nextId = 1n;
  failCreate = false;

  async findById(id: bigint): Promise<FileRecord | null> {
    return this.files.get(id) ?? null;
  }

  async findStoredById(id: bigint): Promise<StoredFileRecord | null> {
    return this.files.get(id) ?? null;
  }

  async listByParent(parentId: bigint | null): Promise<FileRecord[]> {
    return [...this.files.values()].filter(
      (file) => file.parentId === parentId,
    );
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

  async countChildren(parentId: bigint): Promise<number> {
    return [...this.files.values()].filter(
      (file) => file.parentId === parentId,
    ).length;
  }

  async deleteById(id: bigint): Promise<void> {
    this.files.delete(id);
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
  deleteMessage = vi.fn(async () => undefined);
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

  it("数据库写入失败时删除已上传的 Telegram 消息", async () => {
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

    expect(telegram.deleteMessage).toHaveBeenCalledWith(
      -100123n,
      99n,
    );
  });

  it("上传流被截断时删除 Telegram 消息且不写数据库", async () => {
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
    expect(telegram.deleteMessage).toHaveBeenCalledWith(
      -100123n,
      99n,
    );
  });

  it("拒绝删除非空目录", async () => {
    const repository = new MemoryRepository();
    repository.files.set(1n, {
      ...record({ id: 1n, name: "docs", type: "folder" }),
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

    await expect(service.deleteFile(1n)).rejects.toMatchObject(
      {
        statusCode: 409,
        code: "FOLDER_NOT_EMPTY",
      },
    );
  });
});

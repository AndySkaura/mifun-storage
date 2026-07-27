import type { PrismaClient } from "@prisma/client";
import type {
  FileRecord,
  FileRepository,
  StoredFileRecord,
} from "./file.types.js";

const fileSelection = {
  id: true,
  parentId: true,
  name: true,
  type: true,
  size: true,
  mimeType: true,
  extension: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaFileRepository implements FileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: bigint): Promise<FileRecord | null> {
    return this.prisma.file.findUnique({
      where: { id },
      select: fileSelection,
    });
  }

  async findStoredById(id: bigint): Promise<StoredFileRecord | null> {
    return this.prisma.file.findUnique({
      where: { id },
      include: {
        telegram: {
          select: {
            telegramChatId: true,
            telegramMessageId: true,
            telegramFileId: true,
            telegramFileUniqueId: true,
            fileSize: true,
          },
        },
      },
    });
  }

  async listByParent(parentId: bigint | null): Promise<FileRecord[]> {
    return this.prisma.file.findMany({
      where: { parentId },
      orderBy: [{ type: "desc" }, { name: "asc" }, { id: "asc" }],
      select: fileSelection,
    });
  }

  async createFolder(input: {
    parentId: bigint | null;
    name: string;
  }): Promise<FileRecord> {
    return this.prisma.file.create({
      data: {
        parentId: input.parentId,
        name: input.name,
        type: "folder",
      },
      select: fileSelection,
    });
  }

  async createStoredFile(
    input: Parameters<FileRepository["createStoredFile"]>[0],
  ): Promise<FileRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const file = await transaction.file.create({
        data: {
          parentId: input.parentId,
          name: input.name,
          type: "file",
          size: input.size,
          mimeType: input.mimeType,
          extension: input.extension,
        },
        select: fileSelection,
      });

      await transaction.telegramFile.create({
        data: {
          fileId: file.id,
          telegramChatId: input.telegram.chatId,
          telegramMessageId: input.telegram.messageId,
          telegramFileId: input.telegram.fileId,
          telegramFileUniqueId: input.telegram.fileUniqueId,
          fileSize: input.telegram.fileSize,
        },
      });

      return file;
    });
  }

  async countChildren(parentId: bigint): Promise<number> {
    return this.prisma.file.count({ where: { parentId } });
  }

  async deleteById(id: bigint): Promise<void> {
    await this.prisma.file.delete({ where: { id } });
  }
}

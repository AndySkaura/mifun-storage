import type { PrismaClient } from "@prisma/client";
import type {
  FileRecord,
  FileRepository,
  StoredFileRecord,
  TagRecord,
} from "./file.types.js";

const tagSelection = {
  id: true,
  slug: true,
  name: true,
  color: true,
  sortOrder: true,
} as const;

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
  tags: {
    where: { deletedAt: null },
    select: {
      tag: {
        select: tagSelection,
      },
    },
  },
} as const;

interface SelectedFile {
  id: bigint;
  parentId: bigint | null;
  name: string;
  type: "file" | "folder";
  size: bigint;
  mimeType: string | null;
  extension: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: Array<{ tag: TagRecord }>;
}

function mapFile(file: SelectedFile): FileRecord {
  return {
    id: file.id,
    parentId: file.parentId,
    name: file.name,
    type: file.type,
    size: file.size,
    mimeType: file.mimeType,
    extension: file.extension,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    tags: file.tags
      .map(({ tag }) => tag)
      .sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

export class PrismaFileRepository implements FileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: bigint): Promise<FileRecord | null> {
    const file = await this.prisma.file.findUnique({
      where: { id, deletedAt: null },
      select: fileSelection,
    });
    return file ? mapFile(file) : null;
  }

  async findStoredById(id: bigint): Promise<StoredFileRecord | null> {
    const file = await this.prisma.file.findUnique({
      where: { id, deletedAt: null },
      select: {
        ...fileSelection,
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
    return file
      ? {
          ...mapFile(file),
          telegram: file.telegram,
        }
      : null;
  }

  async listByParent(parentId: bigint | null): Promise<FileRecord[]> {
    const files = await this.prisma.file.findMany({
      where: { parentId, deletedAt: null },
      orderBy: [{ type: "desc" }, { name: "asc" }, { id: "asc" }],
      select: fileSelection,
    });
    return files.map(mapFile);
  }

  async listByTag(slug: string): Promise<FileRecord[]> {
    const files = await this.prisma.file.findMany({
      where: {
        deletedAt: null,
        tags: {
          some: {
            deletedAt: null,
            tag: { slug },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: fileSelection,
    });
    return files.map(mapFile);
  }

  async listTags(): Promise<TagRecord[]> {
    return this.prisma.tag.findMany({
      orderBy: { sortOrder: "asc" },
      select: tagSelection,
    });
  }

  async replaceTags(
    fileId: bigint,
    slugs: string[],
  ): Promise<TagRecord[]> {
    return this.prisma.$transaction(async (transaction) => {
      const tags = await transaction.tag.findMany({
        where: { slug: { in: slugs } },
        orderBy: { sortOrder: "asc" },
        select: tagSelection,
      });
      const tagIds = tags.map((tag) => tag.id);

      await transaction.fileTag.updateMany({
        where: {
          fileId,
          deletedAt: null,
          ...(tagIds.length > 0
            ? { tagId: { notIn: tagIds } }
            : {}),
        },
        data: { deletedAt: new Date() },
      });

      for (const tag of tags) {
        await transaction.fileTag.upsert({
          where: {
            fileId_tagId: {
              fileId,
              tagId: tag.id,
            },
          },
          create: {
            fileId,
            tagId: tag.id,
          },
          update: {
            deletedAt: null,
          },
        });
      }

      return tags;
    });
  }

  async createFolder(input: {
    parentId: bigint | null;
    name: string;
  }): Promise<FileRecord> {
    const file = await this.prisma.file.create({
      data: {
        parentId: input.parentId,
        name: input.name,
        type: "folder",
      },
      select: fileSelection,
    });
    return mapFile(file);
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

      return mapFile(file);
    });
  }

  async softDeleteById(id: bigint): Promise<void> {
    await this.prisma.file.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

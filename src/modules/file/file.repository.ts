import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  FilePage,
  FilePageOptions,
  FileRecord,
  FileRepository,
  StorageLocationRecord,
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
  storageLocationId: true,
  parentId: true,
  name: true,
  type: true,
  size: true,
  mimeType: true,
  extension: true,
  contentToken: true,
  privateContentToken: true,
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
  telegram: {
    select: {
      thumbnailFileId: true,
    },
  },
} as const;

interface SelectedFile {
  id: bigint;
  storageLocationId: bigint;
  parentId: bigint | null;
  name: string;
  type: "file" | "folder";
  size: bigint;
  mimeType: string | null;
  extension: string | null;
  contentToken: string | null;
  privateContentToken: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: Array<{ tag: TagRecord }>;
  telegram: { thumbnailFileId: string | null } | null;
}

function mapFile(file: SelectedFile): FileRecord {
  return {
    id: file.id,
    storageLocationId: file.storageLocationId,
    parentId: file.parentId,
    name: file.name,
    type: file.type,
    size: file.size,
    mimeType: file.mimeType,
    extension: file.extension,
    contentToken: file.contentToken,
    privateContentToken: file.privateContentToken,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    hasThumbnail: Boolean(file.telegram?.thumbnailFileId),
    tags: file.tags
      .map(({ tag }) => tag)
      .sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

function createOrderBy(
  options: FilePageOptions,
): Prisma.FileOrderByWithRelationInput[] {
  if (options.sortBy === "name") {
    return [
      { type: "desc" },
      { name: options.sortOrder },
      { id: "asc" },
    ];
  }

  return [
    { [options.sortBy]: options.sortOrder },
    { name: "asc" },
    { id: "asc" },
  ];
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
            thumbnailFileId: true,
            thumbnailFileUniqueId: true,
            thumbnailWidth: true,
            thumbnailHeight: true,
            thumbnailFileSize: true,
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

  async findStoredByContentToken(
    contentToken: string,
  ): Promise<StoredFileRecord | null> {
    const file = await this.prisma.file.findUnique({
      where: { contentToken, deletedAt: null },
      select: {
        ...fileSelection,
        telegram: {
          select: {
            telegramChatId: true,
            telegramMessageId: true,
            telegramFileId: true,
            telegramFileUniqueId: true,
            fileSize: true,
            thumbnailFileId: true,
            thumbnailFileUniqueId: true,
            thumbnailWidth: true,
            thumbnailHeight: true,
            thumbnailFileSize: true,
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

  async findStoredByPrivateContentToken(
    privateContentToken: string,
  ): Promise<StoredFileRecord | null> {
    const file = await this.prisma.file.findUnique({
      where: { privateContentToken, deletedAt: null },
      select: {
        ...fileSelection,
        telegram: {
          select: {
            telegramChatId: true,
            telegramMessageId: true,
            telegramFileId: true,
            telegramFileUniqueId: true,
            fileSize: true,
            thumbnailFileId: true,
            thumbnailFileUniqueId: true,
            thumbnailWidth: true,
            thumbnailHeight: true,
            thumbnailFileSize: true,
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

  async listPageByParent(
    storageLocationId: bigint,
    parentId: bigint | null,
    options: FilePageOptions,
  ): Promise<FilePage> {
    const where: Prisma.FileWhereInput = {
      storageLocationId,
      parentId,
      deletedAt: null,
    };
    const [files, total] = await this.prisma.$transaction([
      this.prisma.file.findMany({
        where,
        orderBy: createOrderBy(options),
        skip: options.offset,
        take: options.limit,
        select: fileSelection,
      }),
      this.prisma.file.count({ where }),
    ]);
    return { items: files.map(mapFile), total };
  }

  async searchByName(
    storageLocationId: bigint,
    query: string,
    options: FilePageOptions,
  ): Promise<FilePage> {
    const where: Prisma.FileWhereInput = {
      storageLocationId,
      deletedAt: null,
      name: { contains: query },
    };
    const [files, total] = await this.prisma.$transaction([
      this.prisma.file.findMany({
        where,
        orderBy: createOrderBy(options),
        skip: options.offset,
        take: options.limit,
        select: fileSelection,
      }),
      this.prisma.file.count({ where }),
    ]);
    return { items: files.map(mapFile), total };
  }

  async listByTag(
    storageLocationId: bigint,
    slug: string,
    options: FilePageOptions,
  ): Promise<FilePage> {
    const where: Prisma.FileWhereInput = {
      storageLocationId,
      deletedAt: null,
      tags: {
        some: {
          deletedAt: null,
          tag: { slug },
        },
      },
    };
    const [files, total] = await this.prisma.$transaction([
      this.prisma.file.findMany({
        where,
        orderBy: createOrderBy(options),
        skip: options.offset,
        take: options.limit,
        select: fileSelection,
      }),
      this.prisma.file.count({ where }),
    ]);
    return { items: files.map(mapFile), total };
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

  async listStorageLocations(): Promise<StorageLocationRecord[]> {
    return this.prisma.storageLocation.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  async findStorageLocation(
    id: bigint,
  ): Promise<StorageLocationRecord | null> {
    return this.prisma.storageLocation.findUnique({ where: { id } });
  }

  async createStorageLocation(
    input: Parameters<FileRepository["createStorageLocation"]>[0],
  ): Promise<StorageLocationRecord> {
    return this.prisma.storageLocation.create({ data: input });
  }

  async updateStorageLocation(
    input: Parameters<FileRepository["updateStorageLocation"]>[0],
  ): Promise<StorageLocationRecord> {
    return this.prisma.storageLocation.update({
      where: { id: input.id },
      data: {
        name: input.name,
        anonymousAccess: input.anonymousAccess,
        ...(input.passwordHash !== undefined
          ? { passwordHash: input.passwordHash }
          : {}),
      },
    });
  }

  async deleteStorageLocation(id: bigint): Promise<void> {
    await this.prisma.storageLocation.delete({ where: { id } });
  }

  async countFilesInStorageLocation(id: bigint): Promise<number> {
    return this.prisma.file.count({
      where: { storageLocationId: id, deletedAt: null },
    });
  }

  async createFolder(input: {
    storageLocationId: bigint;
    parentId: bigint | null;
    name: string;
  }): Promise<FileRecord> {
    const file = await this.prisma.file.create({
      data: {
        storageLocationId: input.storageLocationId,
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
          storageLocationId: input.storageLocationId,
          parentId: input.parentId,
          name: input.name,
          type: "file",
          size: input.size,
          mimeType: input.mimeType,
          extension: input.extension,
          contentToken: input.contentToken,
          privateContentToken: input.privateContentToken,
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
          thumbnailFileId: input.telegram.thumbnail?.fileId,
          thumbnailFileUniqueId:
            input.telegram.thumbnail?.fileUniqueId,
          thumbnailWidth: input.telegram.thumbnail?.width,
          thumbnailHeight: input.telegram.thumbnail?.height,
          thumbnailFileSize: input.telegram.thumbnail?.fileSize,
        },
      });

      return {
        ...mapFile(file),
        hasThumbnail: Boolean(input.telegram.thumbnail?.fileId),
      };
    });
  }

  async softDeleteById(id: bigint): Promise<void> {
    await this.prisma.file.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

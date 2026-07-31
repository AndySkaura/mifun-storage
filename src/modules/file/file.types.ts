import type { Readable } from "node:stream";

export type VirtualFileType = "file" | "folder";
export type FileSortBy = "name" | "updatedAt" | "size";
export type SortOrder = "asc" | "desc";
export type AnonymousAccess = "hidden" | "read" | "write";

export interface StorageLocationRecord {
  id: bigint;
  name: string;
  anonymousAccess: AnonymousAccess;
  passwordHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FilePageOptions {
  offset: number;
  limit: number;
  sortBy: FileSortBy;
  sortOrder: SortOrder;
}

export interface FilePage {
  items: FileRecord[];
  total: number;
}

export interface TagRecord {
  id: bigint;
  slug: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface FileRecord {
  id: bigint;
  storageLocationId: bigint;
  parentId: bigint | null;
  name: string;
  type: VirtualFileType;
  size: bigint;
  mimeType: string | null;
  extension: string | null;
  contentToken: string | null;
  privateContentToken: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: TagRecord[];
  hasThumbnail: boolean;
}

export interface StoredFileRecord extends FileRecord {
  telegram: {
    telegramChatId: bigint;
    telegramMessageId: bigint;
    telegramFileId: string;
    telegramFileUniqueId: string | null;
    fileSize: bigint | null;
    thumbnailFileId?: string | null;
    thumbnailFileUniqueId?: string | null;
    thumbnailWidth?: number | null;
    thumbnailHeight?: number | null;
    thumbnailFileSize?: bigint | null;
  } | null;
}

export interface TelegramThumbnail {
  fileId: string;
  fileUniqueId: string | null;
  width: number;
  height: number;
  fileSize: bigint | null;
}

export interface TelegramUploadResult {
  chatId: bigint;
  messageId: bigint;
  fileId: string;
  fileUniqueId: string | null;
  fileSize: bigint;
  thumbnail?: TelegramThumbnail | null;
}

export interface TelegramStorage {
  uploadFile(
    stream: Readable,
    filename: string,
    mimeType?: string,
    thumbnail?: Buffer,
  ): Promise<TelegramUploadResult>;
  downloadFile(fileId: string): Promise<Readable>;
}

export interface FileRepository {
  findById(id: bigint): Promise<FileRecord | null>;
  findStoredById(id: bigint): Promise<StoredFileRecord | null>;
  findStoredByContentToken(
    contentToken: string,
  ): Promise<StoredFileRecord | null>;
  findStoredByPrivateContentToken(
    privateContentToken: string,
  ): Promise<StoredFileRecord | null>;
  listByParent(parentId: bigint | null): Promise<FileRecord[]>;
  listPageByParent(
    storageLocationId: bigint,
    parentId: bigint | null,
    options: FilePageOptions,
  ): Promise<FilePage>;
  searchByName(
    storageLocationId: bigint,
    query: string,
    options: FilePageOptions,
  ): Promise<FilePage>;
  listByTag(
    storageLocationId: bigint,
    slug: string,
    options: FilePageOptions,
  ): Promise<FilePage>;
  listTags(): Promise<TagRecord[]>;
  replaceTags(fileId: bigint, slugs: string[]): Promise<TagRecord[]>;
  listStorageLocations(): Promise<StorageLocationRecord[]>;
  findStorageLocation(id: bigint): Promise<StorageLocationRecord | null>;
  createStorageLocation(input: {
    name: string;
    anonymousAccess: AnonymousAccess;
    passwordHash: string | null;
  }): Promise<StorageLocationRecord>;
  updateStorageLocation(input: {
    id: bigint;
    name: string;
    anonymousAccess: AnonymousAccess;
    passwordHash?: string | null;
  }): Promise<StorageLocationRecord>;
  deleteStorageLocation(id: bigint): Promise<void>;
  countFilesInStorageLocation(id: bigint): Promise<number>;
  createFolder(input: {
    storageLocationId: bigint;
    parentId: bigint | null;
    name: string;
  }): Promise<FileRecord>;
  createStoredFile(input: {
    storageLocationId: bigint;
    parentId: bigint | null;
    name: string;
    size: bigint;
    mimeType: string | null;
    extension: string | null;
    contentToken: string;
    privateContentToken: string;
    telegram: TelegramUploadResult;
  }): Promise<FileRecord>;
  softDeleteById(id: bigint): Promise<void>;
}

export interface FileDto {
  id: string;
  storageLocationId: string;
  parentId: string | null;
  name: string;
  type: VirtualFileType;
  size: string;
  mimeType: string | null;
  extension: string | null;
  contentToken: string | null;
  createdAt: string;
  updatedAt: string;
  hasThumbnail: boolean;
  tags: Array<{
    slug: string;
    name: string;
    color: string;
  }>;
}

export interface FilePageDto {
  data: FileDto[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

export function toFileDto(file: FileRecord): FileDto {
  return {
    id: file.id.toString(),
    storageLocationId: file.storageLocationId.toString(),
    parentId: file.parentId?.toString() ?? null,
    name: file.name,
    type: file.type,
    size: file.size.toString(),
    mimeType: file.mimeType,
    extension: file.extension,
    contentToken: file.contentToken,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    hasThumbnail: file.hasThumbnail,
    tags: file.tags.map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      color: tag.color,
    })),
  };
}

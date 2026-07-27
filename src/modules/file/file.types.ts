import type { Readable } from "node:stream";

export type VirtualFileType = "file" | "folder";
export type FileSortBy = "name" | "updatedAt" | "size";
export type SortOrder = "asc" | "desc";

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
  parentId: bigint | null;
  name: string;
  type: VirtualFileType;
  size: bigint;
  mimeType: string | null;
  extension: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags: TagRecord[];
}

export interface StoredFileRecord extends FileRecord {
  telegram: {
    telegramChatId: bigint;
    telegramMessageId: bigint;
    telegramFileId: string;
    telegramFileUniqueId: string | null;
    fileSize: bigint | null;
  } | null;
}

export interface TelegramUploadResult {
  chatId: bigint;
  messageId: bigint;
  fileId: string;
  fileUniqueId: string | null;
  fileSize: bigint;
}

export interface TelegramStorage {
  uploadFile(
    stream: Readable,
    filename: string,
    mimeType?: string,
  ): Promise<TelegramUploadResult>;
  downloadFile(fileId: string): Promise<Readable>;
}

export interface FileRepository {
  findById(id: bigint): Promise<FileRecord | null>;
  findStoredById(id: bigint): Promise<StoredFileRecord | null>;
  listByParent(parentId: bigint | null): Promise<FileRecord[]>;
  listPageByParent(
    parentId: bigint | null,
    options: FilePageOptions,
  ): Promise<FilePage>;
  searchByName(
    query: string,
    options: FilePageOptions,
  ): Promise<FilePage>;
  listByTag(
    slug: string,
    options: FilePageOptions,
  ): Promise<FilePage>;
  listTags(): Promise<TagRecord[]>;
  replaceTags(fileId: bigint, slugs: string[]): Promise<TagRecord[]>;
  createFolder(input: {
    parentId: bigint | null;
    name: string;
  }): Promise<FileRecord>;
  createStoredFile(input: {
    parentId: bigint | null;
    name: string;
    size: bigint;
    mimeType: string | null;
    extension: string | null;
    telegram: TelegramUploadResult;
  }): Promise<FileRecord>;
  softDeleteById(id: bigint): Promise<void>;
}

export interface FileDto {
  id: string;
  parentId: string | null;
  name: string;
  type: VirtualFileType;
  size: string;
  mimeType: string | null;
  extension: string | null;
  createdAt: string;
  updatedAt: string;
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
    parentId: file.parentId?.toString() ?? null,
    name: file.name,
    type: file.type,
    size: file.size.toString(),
    mimeType: file.mimeType,
    extension: file.extension,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    tags: file.tags.map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      color: tag.color,
    })),
  };
}

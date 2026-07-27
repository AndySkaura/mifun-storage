import type { Readable } from "node:stream";

export type VirtualFileType = "file" | "folder";

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
  deleteMessage(chatId: bigint, messageId: bigint): Promise<void>;
}

export interface FileRepository {
  findById(id: bigint): Promise<FileRecord | null>;
  findStoredById(id: bigint): Promise<StoredFileRecord | null>;
  listByParent(parentId: bigint | null): Promise<FileRecord[]>;
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
  countChildren(parentId: bigint): Promise<number>;
  deleteById(id: bigint): Promise<void>;
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
  };
}

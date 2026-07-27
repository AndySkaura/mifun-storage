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

export class FileService {
  constructor(
    private readonly repository: FileRepository,
    private readonly telegram: TelegramStorage,
    private readonly onCleanupError: (error: unknown) => void = () => {},
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

    try {
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
    } catch (error) {
      await this.cleanupUpload(
        uploaded.chatId,
        uploaded.messageId,
      );
      throw error;
    }
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

  async deleteFile(id: bigint): Promise<void> {
    const file = await this.repository.findStoredById(id);

    if (!file) {
      throw new AppError(404, "FILE_NOT_FOUND", "文件不存在");
    }

    if (file.type === "folder") {
      const children = await this.repository.countChildren(id);
      if (children > 0) {
        throw new AppError(
          409,
          "FOLDER_NOT_EMPTY",
          "目录非空，无法删除",
        );
      }
    } else {
      if (!file.telegram) {
        throw new AppError(
          409,
          "STORAGE_MAPPING_MISSING",
          "文件缺少 Telegram 存储映射",
        );
      }
      await this.telegram.deleteMessage(
        file.telegram.telegramChatId,
        file.telegram.telegramMessageId,
      );
    }

    await this.repository.deleteById(id);
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

  private async cleanupUpload(
    chatId: bigint,
    messageId: bigint,
  ): Promise<void> {
    try {
      await this.telegram.deleteMessage(chatId, messageId);
    } catch (cleanupError) {
      this.onCleanupError(cleanupError);
    }
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

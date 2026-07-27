import { Readable } from "node:stream";
import type { Bot } from "grammy";
import type {
  TelegramStorage,
  TelegramUploadResult,
} from "../file/file.types.js";
import { InputFile } from "./telegram.client.js";

export class TelegramService implements TelegramStorage {
  constructor(
    private readonly bot: Bot,
    private readonly storageChatId: string,
  ) {}

  async uploadFile(
    stream: Readable,
    filename: string,
    mimeType?: string,
  ): Promise<TelegramUploadResult> {
    const message = await this.bot.api.sendDocument(
      this.storageChatId,
      new InputFile(stream, filename),
      {
        caption: filename,
      },
    );
    const document = message.document;

    if (!document) {
      throw new Error("Telegram 未返回 document 信息");
    }

    return {
      chatId: BigInt(message.chat.id),
      messageId: BigInt(message.message_id),
      fileId: document.file_id,
      fileUniqueId: document.file_unique_id ?? null,
      fileSize: BigInt(document.file_size ?? 0),
    };
  }

  async downloadFile(fileId: string): Promise<Readable> {
    const file = await this.bot.api.getFile(fileId);

    if (!file.file_path) {
      throw new Error("Telegram 未返回文件下载路径");
    }

    const url = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
    const response = await fetch(url);

    if (!response.ok || !response.body) {
      throw new Error(`Telegram 文件下载失败（HTTP ${response.status}）`);
    }

    return Readable.fromWeb(
      response.body as import("node:stream/web").ReadableStream,
    );
  }

  async deleteMessage(chatId: bigint, messageId: bigint): Promise<void> {
    await this.bot.api.deleteMessage(
      chatId.toString(),
      Number(messageId),
    );
  }
}

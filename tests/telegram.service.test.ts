import { Readable } from "node:stream";
import type { Bot } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { TelegramService } from "../src/modules/telegram/telegram.service.js";

describe("TelegramService", () => {
  it("上传文档时关闭 Telegram 的内容类型检测", async () => {
    const sendDocument = vi.fn().mockResolvedValue({
      chat: { id: -100123 },
      message_id: 456,
      document: {
        file_id: "telegram-file",
        file_unique_id: "unique-file",
        file_size: 6,
      },
    });
    const bot = {
      api: { sendDocument },
    } as unknown as Bot;
    const service = new TelegramService(bot, "-100123");

    await service.uploadFile(
      Readable.from([Buffer.from("GIF89a")]),
      "animation.gif",
      "image/gif",
    );

    expect(sendDocument).toHaveBeenCalledOnce();
    expect(sendDocument.mock.calls[0]?.[2]).toMatchObject({
      caption: "animation.gif",
      disable_content_type_detection: true,
    });
  });
});

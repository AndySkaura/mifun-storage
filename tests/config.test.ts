import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

describe("loadConfig", () => {
  it("解析必要配置和默认值", () => {
    const config = loadConfig({
      DATABASE_URL: "mysql://user:pass@localhost:3306/tgfs",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_STORAGE_CHAT_ID: "-1001234567890",
    });

    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe("0.0.0.0");
    expect(config.MAX_UPLOAD_SIZE).toBe(50 * 1024 * 1024);
  });

  it("拒绝无效的 chat id", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "mysql://user:pass@localhost:3306/tgfs",
        TELEGRAM_BOT_TOKEN: "token",
        TELEGRAM_STORAGE_CHAT_ID: "invalid",
      }),
    ).toThrow("TELEGRAM_STORAGE_CHAT_ID");
  });
});

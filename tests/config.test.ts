import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

describe("loadConfig", () => {
  it("解析必要配置和默认值", () => {
    const config = loadConfig({
      DATABASE_URL: "mysql://user:pass@localhost:3306/tgfs",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_STORAGE_CHAT_ID: "-1001234567890",
      ADMIN_TOKEN: "test-admin-token-with-at-least-32-characters",
    });

    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe("0.0.0.0");
    expect(config.MAX_UPLOAD_SIZE).toBe(50 * 1024 * 1024);
    expect(config.MAX_DOWNLOAD_SIZE).toBe(20 * 1024 * 1024);
    expect(config.ADMIN_TOKEN).toBe("test-admin-token-with-at-least-32-characters");
  });

  it("拒绝无效的 chat id", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "mysql://user:pass@localhost:3306/tgfs",
        TELEGRAM_BOT_TOKEN: "token",
        TELEGRAM_STORAGE_CHAT_ID: "invalid",
        ADMIN_TOKEN: "test-admin-token-with-at-least-32-characters",
      }),
    ).toThrow("TELEGRAM_STORAGE_CHAT_ID");
  });

  it("接受任意长度的非空管理员 Token", () => {
    const config = loadConfig({
      DATABASE_URL: "mysql://user:pass@localhost:3306/tgfs",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_STORAGE_CHAT_ID: "-1001234567890",
      ADMIN_TOKEN: "x",
    });

    expect(config.ADMIN_TOKEN).toBe("x");
  });

  it("管理员 Token 缺省或为空时关闭鉴权", () => {
    const baseEnvironment = {
      DATABASE_URL: "mysql://user:pass@localhost:3306/tgfs",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_STORAGE_CHAT_ID: "-1001234567890",
    };

    expect(loadConfig(baseEnvironment).ADMIN_TOKEN).toBe("");
    expect(
      loadConfig({ ...baseEnvironment, ADMIN_TOKEN: "" }).ADMIN_TOKEN,
    ).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
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

  it("DATABASE_URL 缺省或为空时回退到本地 SQLite", () => {
    const baseEnvironment = {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_STORAGE_CHAT_ID: "-1001234567890",
    };
    const expected = `file:${resolve(process.cwd(), "data/tgfs.db")}`;

    expect(loadConfig(baseEnvironment).DATABASE_URL).toBe(expected);
    expect(
      loadConfig({ ...baseEnvironment, DATABASE_URL: "  " }).DATABASE_URL,
    ).toBe(expected);
  });

  it("SITE_URL 可选并移除末尾斜杠", () => {
    const baseEnvironment = {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_STORAGE_CHAT_ID: "-1001234567890",
    };

    expect(loadConfig(baseEnvironment).SITE_URL).toBeUndefined();
    expect(
      loadConfig({ ...baseEnvironment, SITE_URL: "  " }).SITE_URL,
    ).toBeUndefined();
    expect(
      loadConfig({
        ...baseEnvironment,
        SITE_URL: "https://storage.example.com/",
      }).SITE_URL,
    ).toBe("https://storage.example.com");
  });

  it("统计页面默认开启且可以通过环境变量关闭", () => {
    const baseEnvironment = {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_STORAGE_CHAT_ID: "-1001234567890",
    };

    expect(loadConfig(baseEnvironment).ABOUT_ENABLED).toBe(true);
    expect(
      loadConfig({
        ...baseEnvironment,
        ABOUT_ENABLED: "false",
      }).ABOUT_ENABLED,
    ).toBe(false);
  });
});

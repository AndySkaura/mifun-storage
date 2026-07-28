import "dotenv/config";
import { resolve } from "node:path";
import { z } from "zod";

const defaultSqliteUrl = `file:${resolve(process.cwd(), "data/tgfs.db")}`;

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  DATABASE_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || defaultSqliteUrl),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_STORAGE_CHAT_ID: z.string().regex(/^-?\d+$/),
  ADMIN_TOKEN: z.string().trim().default(""),
  MAX_UPLOAD_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),
  MAX_DOWNLOAD_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 1024 * 1024),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const result = envSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`环境变量配置无效：${details}`);
  }

  return result.data;
}

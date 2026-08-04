import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createPrismaClient } from "./database/prisma.js";
import { PrismaFileRepository } from "./modules/file/file.repository.js";
import { FileService } from "./modules/file/file.service.js";
import { createTelegramBot } from "./modules/telegram/telegram.client.js";
import { TelegramService } from "./modules/telegram/telegram.service.js";
import { StatisticsService } from "./modules/statistics/statistics.service.js";

// 组合基础设施并启动 HTTP 服务。
const config = loadConfig();
const prisma = await createPrismaClient(config.DATABASE_URL);
const bot = createTelegramBot(config.TELEGRAM_BOT_TOKEN);
const telegram = new TelegramService(
  bot,
  config.TELEGRAM_STORAGE_CHAT_ID,
);
const repository = new PrismaFileRepository(prisma);
const service = new FileService(
  repository,
  telegram,
  config.MAX_DOWNLOAD_SIZE,
  (error) => {
    console.error("软删除复制回滚记录失败", error);
  },
);
const statisticsService = config.ABOUT_ENABLED
  ? new StatisticsService(prisma)
  : undefined;
const app = await buildApp({
  fileService: service,
  statisticsService,
  maxUploadSize: config.MAX_UPLOAD_SIZE,
  adminToken: config.ADMIN_TOKEN,
  siteUrl: config.SITE_URL,
  aboutEnabled: config.ABOUT_ENABLED,
  logger: true,
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "正在关闭服务");
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await prisma.$connect();
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}

import { PrismaClient } from "@prisma/client";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { PrismaClient as SqlitePrismaClient } from "../../generated/sqlite/index.js";

export async function createPrismaClient(
  databaseUrl: string,
): Promise<PrismaClient> {
  if (databaseUrl.startsWith("mysql://")) {
    return new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
  }

  if (!databaseUrl.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL 仅支持 mysql://；留空时将自动使用 SQLite",
    );
  }

  const databasePath = databaseUrl.slice("file:".length).split("?")[0];
  if (!databasePath) {
    throw new Error("SQLite DATABASE_URL 缺少数据库文件路径");
  }

  await mkdir(dirname(databasePath), { recursive: true });
  const prisma = new SqlitePrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  await prisma.$connect();
  await initializeSqlite(prisma);
  // 两份 Schema 的模型完全一致，只是底层 provider 不同。
  return prisma as unknown as PrismaClient;
}

async function initializeSqlite(prisma: SqlitePrismaClient): Promise<void> {
  await prisma.$queryRawUnsafe(`PRAGMA journal_mode = WAL`);

  const statements = [
    `PRAGMA foreign_keys = ON`,
    `CREATE TABLE IF NOT EXISTS "storage_locations" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "name" TEXT NOT NULL,
      "anonymous_access" TEXT NOT NULL DEFAULT 'read',
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "storage_locations_name_key"
      ON "storage_locations"("name")`,
    `CREATE TABLE IF NOT EXISTS "files" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "storage_location_id" INTEGER NOT NULL,
      "parent_id" INTEGER,
      "name" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "size" BIGINT NOT NULL DEFAULT 0,
      "mime_type" TEXT,
      "extension" TEXT,
      "content_token" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL,
      "deleted_at" DATETIME,
      CONSTRAINT "files_storage_location_id_fkey"
        FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS "idx_storage_parent"
      ON "files"("storage_location_id", "parent_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_parent_id" ON "files"("parent_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_deleted_at" ON "files"("deleted_at")`,
    `CREATE TABLE IF NOT EXISTS "tags" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "slug" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "color" TEXT NOT NULL,
      "sort_order" INTEGER NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "tags_slug_key" ON "tags"("slug")`,
    `CREATE TABLE IF NOT EXISTS "file_tags" (
      "file_id" INTEGER NOT NULL,
      "tag_id" INTEGER NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "deleted_at" DATETIME,
      PRIMARY KEY ("file_id", "tag_id"),
      CONSTRAINT "file_tags_file_id_fkey"
        FOREIGN KEY ("file_id") REFERENCES "files"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "file_tags_tag_id_fkey"
        FOREIGN KEY ("tag_id") REFERENCES "tags"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS "idx_file_tags_tag_id"
      ON "file_tags"("tag_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_file_tags_deleted_at"
      ON "file_tags"("deleted_at")`,
    `CREATE TABLE IF NOT EXISTS "telegram_files" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "file_id" INTEGER NOT NULL,
      "telegram_chat_id" BIGINT NOT NULL,
      "telegram_message_id" BIGINT NOT NULL,
      "telegram_file_id" TEXT NOT NULL,
      "telegram_file_unique_id" TEXT,
      "file_size" BIGINT,
      "thumbnail_file_id" TEXT,
      "thumbnail_file_unique_id" TEXT,
      "thumbnail_width" INTEGER,
      "thumbnail_height" INTEGER,
      "thumbnail_file_size" BIGINT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "telegram_files_file_id_fkey"
        FOREIGN KEY ("file_id") REFERENCES "files"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "telegram_files_file_id_key"
      ON "telegram_files"("file_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_telegram_message"
      ON "telegram_files"("telegram_chat_id", "telegram_message_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_file_id" ON "telegram_files"("file_id")`,
    `INSERT OR IGNORE INTO "storage_locations"
      ("id", "name", "anonymous_access", "updated_at")
      VALUES (1, 'TGFS', 'write', CURRENT_TIMESTAMP)`,
    `INSERT OR IGNORE INTO "tags"
      ("slug", "name", "color", "sort_order") VALUES
      ('red', '红色', '#ef4444', 1),
      ('orange', '橙色', '#f97316', 2),
      ('yellow', '黄色', '#eab308', 3),
      ('green', '绿色', '#22c55e', 4),
      ('blue', '蓝色', '#3b82f6', 5),
      ('purple', '紫色', '#a855f7', 6),
      ('pink', '粉色', '#ec4899', 7),
      ('gray', '灰色', '#94a3b8', 8)`,
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const fileColumns = await prisma.$queryRawUnsafe<
    Array<{ name: string }>
  >(`PRAGMA table_info("files")`);
  if (!fileColumns.some((column) => column.name === "content_token")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "files" ADD COLUMN "content_token" TEXT`,
    );
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "files"
      SET "content_token" = LOWER(HEX(RANDOMBLOB(32)))
      WHERE "type" = 'file' AND "content_token" IS NULL`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "files_content_token_key"
      ON "files"("content_token")`,
  );
}

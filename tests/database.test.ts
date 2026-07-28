import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/database/prisma.js";
import { PrismaFileRepository } from "../src/modules/file/file.repository.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("SQLite 数据库回退", () => {
  it("首次启动时自动建表并写入默认数据", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tgfs-sqlite-"));
    temporaryDirectories.push(directory);
    const prisma = await createPrismaClient(
      `file:${join(directory, "tgfs.db")}`,
    );
    const repository = new PrismaFileRepository(prisma);

    try {
      const locations = await repository.listStorageLocations();
      const tags = await repository.listTags();
      const folder = await repository.createFolder({
        storageLocationId: locations[0]!.id,
        parentId: null,
        name: "测试目录",
      });

      expect(locations).toHaveLength(1);
      expect(locations[0]!.name).toBe("TGFS");
      expect(tags).toHaveLength(8);
      expect(folder.name).toBe("测试目录");
    } finally {
      await prisma.$disconnect();
    }
  });
});

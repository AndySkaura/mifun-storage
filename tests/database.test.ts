import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/database/prisma.js";
import { PrismaFileRepository } from "../src/modules/file/file.repository.js";
import type { FilePageOptions } from "../src/modules/file/file.types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("SQLite 数据库回退", () => {
  it("各排序方式的文件定位与分页顺序一致，忽略其他目录和已删除项目", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tgfs-position-"));
    temporaryDirectories.push(directory);
    const prisma = await createPrismaClient(`file:${join(directory, "tgfs.db")}`);
    const repository = new PrismaFileRepository(prisma);
    try {
      const location = (await repository.listStorageLocations())[0]!;
      const folder = await repository.createFolder({
        storageLocationId: location.id, parentId: null, name: "上传目录",
      });
      await prisma.file.createMany({
        data: Array.from({ length: 165 }, (_, index) => ({
          storageLocationId: location.id,
          parentId: folder.id,
          name: `文档-${String(index % 11).padStart(2, "0")}.txt`,
          type: index % 17 === 0 ? "folder" as const : "file" as const,
          size: BigInt(index % 7),
          updatedAt: new Date(1_700_000_000_000 + Math.floor(index / 5) * 1000),
        })),
      });
      const other = await repository.createStorageLocation({
        name: "另一存储位置", anonymousAccess: "read", passwordHash: null,
      });
      await prisma.file.createMany({
        data: [
          { storageLocationId: location.id, parentId: folder.id, name: "已删除", type: "file", deletedAt: new Date() },
          { storageLocationId: location.id, parentId: null, name: "其他目录", type: "file" },
          { storageLocationId: other.id, parentId: null, name: "其他位置", type: "file" },
        ],
      });
      for (const sortBy of ["name", "updatedAt", "size"] as const) {
        for (const sortOrder of ["asc", "desc"] as const) {
          const options: FilePageOptions = { offset: 0, limit: 200, sortBy, sortOrder };
          const page = await repository.listPageByParent(location.id, folder.id, options);
          expect(page.total).toBe(165);
          for (const index of [0, 1, 17, 49, 50, 51, 99, 100, 149, 150, 164]) {
            expect(await repository.countBeforeInParent(page.items[index]!, options))
              .toBe(index);
          }
        }
      }
    } finally {
      await prisma.$disconnect();
    }
  });

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

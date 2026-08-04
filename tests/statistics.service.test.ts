import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/database/prisma.js";
import { StatisticsService } from "../src/modules/statistics/statistics.service.js";

let prisma: PrismaClient | undefined;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  await prisma?.$disconnect();
  prisma = undefined;
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("StatisticsService", () => {
  it("将统计结果持久化并在有效期内直接命中缓存", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "tgfs-statistics-"));
    prisma = await createPrismaClient(
      `file:${join(temporaryDirectory, "statistics.db")}`,
    );
    await prisma.file.createMany({
      data: [
        {
          storageLocationId: 1n,
          parentId: 2n,
          name: "设计稿.webp",
          type: "file",
          size: 2048n,
          extension: "webp",
        },
        {
          storageLocationId: 1n,
          name: "素材",
          type: "folder",
          size: 0n,
        },
      ],
    });
    const service = new StatisticsService(prisma, 60_000);

    const first = await service.getStatistics();
    const second = await service.getStatistics();
    const admin = await service.getStatistics(true);
    const persisted = await prisma.statisticsCache.findUnique({
      where: { key: "public-storage-statistics-v1" },
    });

    expect(first.cache.hit).toBe(false);
    expect(first.data).toMatchObject({
      totalItems: 2,
      totalFiles: 1,
      totalFolders: 1,
      totalBytes: "2048",
      lastItemId: "2",
      folderFileMatrix: [
        {
          id: "2",
          name: "素***材",
          label: "素***材",
          fileCount: 1,
        },
      ],
      recentActivity: [
        expect.objectContaining({
          id: "2",
          name: "素***材",
          label: "+文件夹",
          type: "folder",
          extension: null,
          path: "素***材",
          folderIds: [],
        }),
        expect.objectContaining({
          id: "1",
          name: "设***稿.webp",
          label: "+webp",
          type: "file",
          extension: "webp",
          path: "素***材/设***稿.webp",
          folderIds: ["2"],
        }),
      ],
    });
    expect(second.cache.hit).toBe(true);
    expect(second.data).toEqual(first.data);
    expect(admin.cache.hit).toBe(true);
    expect(admin.data.folderFileMatrix[0]?.name).toBe("素材");
    expect(admin.data.recentActivity[1]?.name).toBe("设计稿.webp");
    expect(admin.data.recentActivity[1]?.path).toBe("素材/设计稿.webp");
    expect(persisted).not.toBeNull();

    await prisma.file.create({
      data: {
        storageLocationId: 1n,
        name: "新增私密原图.avif",
        type: "file",
        size: 4096n,
        extension: "avif",
      },
    });
    await expect(service.getActivity(2n)).resolves.toMatchObject({
      cursor: "3",
      data: [
        {
          id: "3",
          name: "新增***图.avif",
          label: "+avif",
          type: "file",
          extension: "avif",
          size: "4096",
          path: "新增***图.avif",
          folderIds: [],
        },
      ],
    });
  });
});

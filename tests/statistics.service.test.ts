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
    const persisted = await prisma.statisticsCache.findUnique({
      where: { key: "public-storage-statistics-v1" },
    });

    expect(first.cache.hit).toBe(false);
    expect(first.data).toMatchObject({
      totalItems: 2,
      totalFiles: 1,
      totalFolders: 1,
      totalBytes: "2048",
      activityTokens: ["+webp", "+文件夹"],
    });
    expect(second.cache.hit).toBe(true);
    expect(second.data).toEqual(first.data);
    expect(persisted).not.toBeNull();
  });
});

import type { Prisma, PrismaClient } from "@prisma/client";

const CACHE_KEY = "public-storage-statistics-v1";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const MONTH_COUNT = 12;

export interface StatisticsSnapshot {
  totalItems: number;
  totalFiles: number;
  totalFolders: number;
  totalBytes: string;
  storageLocations: number;
  extensionDistribution: Array<{
    label: string;
    count: number;
  }>;
  sizeDistribution: Array<{
    label: string;
    count: number;
  }>;
  monthlyGrowth: Array<{
    month: string;
    files: number;
    folders: number;
  }>;
  activityTokens: string[];
}

export interface StatisticsResult {
  data: StatisticsSnapshot;
  cache: {
    hit: boolean;
    generatedAt: string;
    expiresAt: string;
  };
}

export class StatisticsService {
  private refreshPromise: Promise<StatisticsResult> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  ) {}

  async getStatistics(): Promise<StatisticsResult> {
    const now = new Date();
    const cached = await this.prisma.statisticsCache.findUnique({
      where: { key: CACHE_KEY },
    });
    if (
      cached &&
      cached.expiresAt > now &&
      isStatisticsSnapshot(cached.value)
    ) {
      return {
        data: cached.value as unknown as StatisticsSnapshot,
        cache: {
          hit: true,
          generatedAt: cached.generatedAt.toISOString(),
          expiresAt: cached.expiresAt.toISOString(),
        },
      };
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshStatistics().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async refreshStatistics(): Promise<StatisticsResult> {
    const entries = await this.prisma.file.findMany({
      where: { deletedAt: null },
      select: {
        type: true,
        size: true,
        extension: true,
        createdAt: true,
      },
    });
    const storageLocations = await this.prisma.storageLocation.count();
    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + this.cacheTtlMs);
    const snapshot = buildSnapshot(entries, storageLocations, generatedAt);

    await this.prisma.statisticsCache.upsert({
      where: { key: CACHE_KEY },
      create: {
        key: CACHE_KEY,
        value: snapshot as unknown as Prisma.InputJsonValue,
        generatedAt,
        expiresAt,
      },
      update: {
        value: snapshot as unknown as Prisma.InputJsonValue,
        generatedAt,
        expiresAt,
      },
    });

    return {
      data: snapshot,
      cache: {
        hit: false,
        generatedAt: generatedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    };
  }
}

function buildSnapshot(
  entries: Array<{
    type: "file" | "folder";
    size: bigint;
    extension: string | null;
    createdAt: Date;
  }>,
  storageLocations: number,
  now: Date,
): StatisticsSnapshot {
  const files = entries.filter((entry) => entry.type === "file");
  const folders = entries.length - files.length;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0n);
  const extensionCounts = new Map<string, number>();
  const sizeCounts = [0, 0, 0, 0, 0];

  for (const file of files) {
    const extension = normalizeExtension(file.extension);
    extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
    const size = file.size;
    const sizeIndex =
      size < 1024n * 1024n
        ? 0
        : size < 10n * 1024n * 1024n
          ? 1
          : size < 50n * 1024n * 1024n
            ? 2
            : size < 100n * 1024n * 1024n
              ? 3
              : 4;
    sizeCounts[sizeIndex]! += 1;
  }

  const sortedExtensions = [...extensionCounts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const primaryExtensions = sortedExtensions.slice(0, 7);
  const otherCount = sortedExtensions
    .slice(7)
    .reduce((sum, [, count]) => sum + count, 0);
  if (otherCount) primaryExtensions.push(["其他", otherCount]);

  const months = buildMonthKeys(now);
  const monthMap = new Map(
    months.map((month) => [month, { month, files: 0, folders: 0 }]),
  );
  for (const entry of entries) {
    const month = toMonthKey(entry.createdAt);
    const bucket = monthMap.get(month);
    if (bucket) {
      if (entry.type === "file") bucket.files += 1;
      else bucket.folders += 1;
    }
  }

  const activityTokens = primaryExtensions
    .filter(([label]) => label !== "其他" && label !== "无扩展名")
    .slice(0, 5)
    .map(([label]) => `+${label}`);
  if (!activityTokens.includes("+webp")) activityTokens.push("+webp");
  activityTokens.push("+文件夹");

  return {
    totalItems: entries.length,
    totalFiles: files.length,
    totalFolders: folders,
    totalBytes: totalBytes.toString(),
    storageLocations,
    extensionDistribution: primaryExtensions.map(([label, count]) => ({
      label,
      count,
    })),
    sizeDistribution: [
      "< 1 MB",
      "1–10 MB",
      "10–50 MB",
      "50–100 MB",
      "≥ 100 MB",
    ].map((label, index) => ({ label, count: sizeCounts[index]! })),
    monthlyGrowth: months.map((month) => monthMap.get(month)!),
    activityTokens,
  };
}

function buildMonthKeys(now: Date): string[] {
  const months: string[] = [];
  for (let offset = MONTH_COUNT - 1; offset >= 0; offset -= 1) {
    months.push(
      toMonthKey(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)),
      ),
    );
  }
  return months;
}

function toMonthKey(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function normalizeExtension(extension: string | null): string {
  const normalized = extension?.trim().toLowerCase();
  return normalized ? normalized.slice(0, 20) : "无扩展名";
}

function isStatisticsSnapshot(
  value: Prisma.JsonValue,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, Prisma.JsonValue>;
  return (
    typeof candidate.totalItems === "number" &&
    typeof candidate.totalFiles === "number" &&
    typeof candidate.totalFolders === "number" &&
    typeof candidate.totalBytes === "string" &&
    Array.isArray(candidate.extensionDistribution) &&
    Array.isArray(candidate.sizeDistribution) &&
    Array.isArray(candidate.monthlyGrowth) &&
    Array.isArray(candidate.activityTokens)
  );
}

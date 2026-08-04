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
  folderFileMatrix: Array<{
    id: string;
    name: string;
    label: string;
    fileCount: number;
  }>;
  monthlyGrowth: Array<{
    month: string;
    files: number;
    folders: number;
  }>;
  lastItemId: string;
  recentActivity: StatisticsActivity[];
}

export interface StatisticsActivity {
  id: string;
  name: string;
  label: string;
  type: "file" | "folder";
  extension: string | null;
  size: string;
  createdAt: string;
  path: string;
  folderIds: string[];
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

  async getStatistics(isAdmin = false): Promise<StatisticsResult> {
    const now = new Date();
    const cached = await this.prisma.statisticsCache.findUnique({
      where: { key: CACHE_KEY },
    });
    if (
      cached &&
      cached.expiresAt > now &&
      isStatisticsSnapshot(cached.value)
    ) {
      return presentStatistics({
        data: cached.value as unknown as StatisticsSnapshot,
        cache: {
          hit: true,
          generatedAt: cached.generatedAt.toISOString(),
          expiresAt: cached.expiresAt.toISOString(),
        },
      }, isAdmin);
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshStatistics().finally(() => {
        this.refreshPromise = null;
      });
    }
    return presentStatistics(await this.refreshPromise, isAdmin);
  }

  async getActivity(
    afterId: bigint,
    limit = 20,
    isAdmin = false,
  ): Promise<{ data: StatisticsActivity[]; cursor: string }> {
    const entries = await this.prisma.file.findMany({
      where: {
        id: { gt: afterId },
        deletedAt: null,
      },
      orderBy: { id: "asc" },
      take: limit,
      select: {
        id: true,
        name: true,
        parentId: true,
        type: true,
        size: true,
        extension: true,
        createdAt: true,
      },
    });
    const data = await Promise.all(entries.map(async (entry) => {
      const path = await resolveEntryPath(this.prisma, entry);
      return presentActivity(toActivity(entry, path), isAdmin);
    }));
    return {
      data,
      cursor: (entries.at(-1)?.id ?? afterId).toString(),
    };
  }

  private async refreshStatistics(): Promise<StatisticsResult> {
    const entries = await this.prisma.file.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        parentId: true,
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
    id: bigint;
    name: string;
    parentId: bigint | null;
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

  for (const file of files) {
    const extension = normalizeExtension(file.extension);
    extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
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

  const orderedEntries = [...entries].sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() ||
      Number(right.id - left.id),
  );
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const folderEntries = entries.filter(
    (entry) => entry.type === "folder",
  );
  const folderById = new Map(
    folderEntries.map((folder) => [folder.id, folder]),
  );
  const folderCounts = new Map(
    folderEntries.map((folder) => [
      folder.id,
      { fileCount: 0 },
    ]),
  );
  for (const file of files) {
    let parentId = file.parentId;
    const visited = new Set<bigint>();
    while (parentId !== null && !visited.has(parentId)) {
      visited.add(parentId);
      const totals = folderCounts.get(parentId);
      const folder = folderById.get(parentId);
      if (!totals || !folder) break;
      totals.fileCount += 1;
      parentId = folder.parentId;
    }
  }
  const folderFileMatrix = folderEntries
    .map((folder) => ({
      id: folder.id.toString(),
      name: folder.name,
      label: folder.name,
      fileCount: folderCounts.get(folder.id)!.fileCount,
    }))
    .sort(
      (left, right) =>
        right.fileCount - left.fileCount ||
        Number(BigInt(left.id) - BigInt(right.id)),
    )
    .slice(0, 40);

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
    folderFileMatrix,
    monthlyGrowth: months.map((month) => monthMap.get(month)!),
    lastItemId: entries.reduce(
      (maximum, entry) => (entry.id > maximum ? entry.id : maximum),
      0n,
    ).toString(),
    recentActivity: orderedEntries.slice(0, 8).map((entry) =>
      toActivity(entry, buildEntryPath(entry, entryById))
    ),
  };
}

function toActivity(entry: {
  id: bigint;
  name: string;
  parentId?: bigint | null;
  type: "file" | "folder";
  size: bigint;
  extension: string | null;
  createdAt: Date;
}, path: { value: string; folderIds: string[] }): StatisticsActivity {
  return {
    id: entry.id.toString(),
    name: entry.name,
    label:
      entry.type === "folder"
        ? "+文件夹"
        : `+${normalizeExtension(entry.extension)}`,
    type: entry.type,
    extension:
      entry.type === "file" ? normalizeExtension(entry.extension) : null,
    size: entry.size.toString(),
    createdAt: entry.createdAt.toISOString(),
    path: path.value,
    folderIds: path.folderIds,
  };
}

function presentStatistics(
  result: StatisticsResult,
  isAdmin: boolean,
): StatisticsResult {
  return {
    cache: result.cache,
    data: {
      ...result.data,
      folderFileMatrix: result.data.folderFileMatrix.map((folder) => ({
        ...folder,
        name: displayName(folder.name, isAdmin, false),
        label: displayName(folder.name, isAdmin, false),
      })),
      recentActivity: result.data.recentActivity.map((entry) =>
        presentActivity(entry, isAdmin)
      ),
    },
  };
}

function presentActivity(
  entry: StatisticsActivity,
  isAdmin: boolean,
): StatisticsActivity {
  return {
    ...entry,
    name: displayName(entry.name, isAdmin, entry.type === "file"),
    path: entry.path
      .split("/")
      .map((part, index, parts) =>
        displayName(
          part,
          isAdmin,
          entry.type === "file" && index === parts.length - 1,
        )
      )
      .join("/"),
  };
}

function displayName(
  name: string,
  isAdmin: boolean,
  preserveExtension: boolean,
): string {
  if (isAdmin) return name;
  const extensionIndex = preserveExtension ? name.lastIndexOf(".") : -1;
  const basename = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : "";
  const characters = Array.from(basename);
  if (characters.length === 0) return `***${extension}`;
  if (characters.length === 1) return `${characters[0]}***${extension}`;
  const prefixLength = characters.length >= 4 ? 2 : 1;
  return `${characters.slice(0, prefixLength).join("")}***${characters.at(-1)}${extension}`;
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

function buildEntryPath(
  entry: {
    name: string;
    parentId?: bigint | null;
  },
  entriesById: Map<bigint, {
    id: bigint;
    name: string;
    parentId: bigint | null;
    type: "file" | "folder";
  }>,
): { value: string; folderIds: string[] } {
  const parts = [entry.name];
  const folderIds: string[] = [];
  const visited = new Set<bigint>();
  let parentId = entry.parentId ?? null;
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = entriesById.get(parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    if (parent.type === "folder") folderIds.unshift(parent.id.toString());
    parentId = parent.parentId;
  }
  return { value: parts.join("/"), folderIds };
}

async function resolveEntryPath(
  prisma: PrismaClient,
  entry: {
    name: string;
    parentId: bigint | null;
  },
): Promise<{ value: string; folderIds: string[] }> {
  const parts = [entry.name];
  const folderIds: string[] = [];
  const visited = new Set<bigint>();
  let parentId = entry.parentId;
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = await prisma.file.findUnique({
      where: { id: parentId },
      select: { id: true, name: true, parentId: true, type: true },
    });
    if (!parent) break;
    parts.unshift(parent.name);
    if (parent.type === "folder") folderIds.unshift(parent.id.toString());
    parentId = parent.parentId;
  }
  return { value: parts.join("/"), folderIds };
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
    Array.isArray(candidate.folderFileMatrix) &&
    candidate.folderFileMatrix.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as Record<string, Prisma.JsonValue>).name === "string",
    ) &&
    Array.isArray(candidate.monthlyGrowth) &&
    typeof candidate.lastItemId === "string" &&
    Array.isArray(candidate.recentActivity) &&
    candidate.recentActivity.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as Record<string, Prisma.JsonValue>).name === "string" &&
        typeof (item as Record<string, Prisma.JsonValue>).path === "string",
    )
  );
}

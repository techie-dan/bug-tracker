import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Point balances and the leaderboard (#428), always inside one tenant.
 *
 * A balance is the sum of a person's ledger rows, corrections included. A
 * solved task is a positive solver entry that hasn't been corrected.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type PointTotals = { points: number; solvedTasks: number };

export type LeaderboardEntry = PointTotals & {
  userId: string;
  name: string;
  image: string | null;
  rank: number;
};

export type LeaderboardOptions = {
  page?: number;
  limit?: number;
};

export type PaginatedLeaderboard = {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export const DEFAULT_LEADERBOARD_LIMIT = 50;

// Cache with revalidation (#657)
const CACHE_TTL_MS = 30_000;
type CacheEntry = {
  expiresAt: number;
  data: PaginatedLeaderboard;
};
const cache = new Map<string, CacheEntry>();

export function clearLeaderboardCache(tenantId?: string): void {
  if (!tenantId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${tenantId}:`)) {
      cache.delete(key);
    }
  }
}

const solvedWhere = (tenantId: string): Prisma.PointEntryWhereInput => ({
  tenantId,
  role: "solver",
  points: { gt: 0 },
  correctedAt: null,
});

/** One person's balance and solved-task count in `tenantId`. */
export async function pointTotals(db: Db, tenantId: string, userId: string): Promise<PointTotals> {
  const [sum, solvedTasks] = await Promise.all([
    db.pointEntry.aggregate({ where: { tenantId, userId }, _sum: { points: true } }),
    db.pointEntry.count({ where: { ...solvedWhere(tenantId), userId } }),
  ]);
  return { points: sum._sum.points ?? 0, solvedTasks };
}

/**
 * Orders people by points, then solved tasks, then name, and numbers them.
 * People level on both points and solved tasks share a rank (1, 2, 2, 4).
 */
export function rankLeaderboard(
  rows: ReadonlyArray<Omit<LeaderboardEntry, "rank">>,
  offset = 0,
): LeaderboardEntry[] {
  const sorted = [...rows].sort(
    (a, b) => b.points - a.points || b.solvedTasks - a.solvedTasks || a.name.localeCompare(b.name),
  );
  const ranked: LeaderboardEntry[] = [];
  sorted.forEach((row, index) => {
    const previous = ranked[index - 1];
    const tied = previous && previous.points === row.points && previous.solvedTasks === row.solvedTasks;
    ranked.push({ ...row, rank: tied ? previous.rank : offset + index + 1 });
  });
  return ranked;
}

/** Members of `tenantId` with any points, paginated and ranked (#657). */
export async function paginatedTenantLeaderboard(
  db: Db,
  tenantId: string,
  options: LeaderboardOptions = {},
): Promise<PaginatedLeaderboard> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, Math.min(100, options.limit ?? DEFAULT_LEADERBOARD_LIMIT));
  const offset = (page - 1) * limit;

  const cacheKey = `${tenantId}:${page}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Fast-path: If db supports $queryRaw (Postgres in production), execute single optimized aggregation query with LIMIT/OFFSET.
  if (typeof (db as PrismaClient).$queryRaw === "function") {
    try {
      type RawRow = {
        userId: string;
        name: string;
        image: string | null;
        points: number | bigint;
        solvedTasks: number | bigint;
      };
      type CountRow = { count: number | bigint };

      const [rawRows, countRows] = await Promise.all([
        (db as PrismaClient).$queryRaw<RawRow[]>`
          SELECT
            u."id" AS "userId",
            u."name" AS "name",
            u."image" AS "image",
            COALESCE(SUM(pe."points"), 0)::int AS "points",
            COALESCE(COUNT(CASE WHEN pe."role" = 'solver' AND pe."points" > 0 AND pe."correctedAt" IS NULL THEN 1 END), 0)::int AS "solvedTasks"
          FROM "User" u
          INNER JOIN "Membership" m ON m."userId" = u."id" AND m."tenantId" = ${tenantId}
          INNER JOIN "PointEntry" pe ON pe."userId" = u."id" AND pe."tenantId" = ${tenantId}
          GROUP BY u."id", u."name", u."image"
          ORDER BY "points" DESC, "solvedTasks" DESC, u."name" ASC
          LIMIT ${limit} OFFSET ${offset}
        `,
        (db as PrismaClient).$queryRaw<CountRow[]>`
          SELECT COUNT(DISTINCT pe."userId")::int AS "count"
          FROM "PointEntry" pe
          INNER JOIN "Membership" m ON m."userId" = pe."userId" AND m."tenantId" = ${tenantId}
          WHERE pe."tenantId" = ${tenantId}
        `,
      ]);

      const total = Number(countRows[0]?.count ?? 0);
      const rows = rawRows.map((r) => ({
        userId: r.userId,
        name: r.name,
        image: r.image,
        points: Number(r.points),
        solvedTasks: Number(r.solvedTasks),
      }));

      const entries = rankLeaderboard(rows, offset);
      const totalPages = Math.ceil(total / limit) || 1;
      const result: PaginatedLeaderboard = { entries, total, page, limit, totalPages };

      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: result });
      return result;
    } catch {
      // Fallback to Prisma API (e.g. if unit tests mock PrismaClient without $queryRaw)
    }
  }

  // Fallback path using Prisma query methods
  const memberOnly = { user: { memberships: { some: { tenantId } } } } satisfies Prisma.PointEntryWhereInput;
  const [balances, solved] = await Promise.all([
    db.pointEntry.groupBy({
      by: ["userId"],
      where: { tenantId, ...memberOnly },
      _sum: { points: true },
    }),
    db.pointEntry.groupBy({
      by: ["userId"],
      where: { ...solvedWhere(tenantId), ...memberOnly },
      _count: { _all: true },
    }),
  ]);

  if (balances.length === 0) {
    const emptyResult = { entries: [], total: 0, page, limit, totalPages: 1 };
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: emptyResult });
    return emptyResult;
  }

  const users = await db.user.findMany({
    where: { id: { in: balances.map((b) => b.userId) } },
    select: { id: true, name: true, image: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const solvedById = new Map(solved.map((s) => [s.userId, s._count._all]));

  const allRows = balances.flatMap((b) => {
    const user = byId.get(b.userId);
    if (!user) return [];
    return [{
      userId: b.userId,
      name: user.name,
      image: user.image,
      points: b._sum.points ?? 0,
      solvedTasks: solvedById.get(b.userId) ?? 0,
    }];
  });

  const total = allRows.length;
  const allRanked = rankLeaderboard(allRows);
  const entries = allRanked.slice(offset, offset + limit);
  const totalPages = Math.ceil(total / limit) || 1;

  const result: PaginatedLeaderboard = { entries, total, page, limit, totalPages };
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: result });
  return result;
}

/** Members of `tenantId` with any points, ranked. Non-members never appear. */
export async function tenantLeaderboard(
  db: Db,
  tenantId: string,
  limitOrOptions: number | LeaderboardOptions = DEFAULT_LEADERBOARD_LIMIT,
): Promise<LeaderboardEntry[]> {
  const options = typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const result = await paginatedTenantLeaderboard(db, tenantId, options);
  return result.entries;
}

import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Watching issues (#216).
 *
 * Who hears about an issue = the people involved by default (reporter,
 * assignee, and whoever else the event names) plus anyone who chose
 * "Watch", minus anyone who chose "Unwatch". Rows are only written when
 * someone gets involved or toggles the button, so issues created before
 * this feature still notify their reporter and assignee.
 */

export type WatchRow = { userId: string; watching: boolean };

/** Pure: combine the default audience with explicit watch / unwatch rows. */
export function resolveWatchers(
  defaults: readonly (string | null | undefined)[],
  rows: readonly WatchRow[],
): string[] {
  const muted = new Set(rows.filter((r) => !r.watching).map((r) => r.userId));
  const result: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !muted.has(id) && !result.includes(id)) result.push(id);
  };
  defaults.forEach(add);
  rows.filter((r) => r.watching).forEach((r) => add(r.userId));
  return result;
}

type Db = Pick<PrismaClient, "issueWatch"> | Pick<Prisma.TransactionClient, "issueWatch">;

/** Everyone who should hear about an event on this issue. */
export async function watchersFor(
  db: Db,
  bugId: string,
  defaults: readonly (string | null | undefined)[],
): Promise<string[]> {
  const rows = await db.issueWatch.findMany({
    where: { bugId },
    select: { userId: true, watching: true },
  });
  return resolveWatchers(defaults, rows);
}

/** People who explicitly muted this issue, so reply planners can skip them (#738). */
export async function mutedUsersFor(db: Db, bugId: string): Promise<string[]> {
  const rows = await db.issueWatch.findMany({
    where: { bugId },
    select: { userId: true, watching: true },
  });
  return rows.filter((row) => !row.watching).map((row) => row.userId);
}

/**
 * Start watching for people who just got involved (reported, were assigned,
 * commented). Never overrides an explicit "Unwatch".
 */
export async function ensureWatching(
  db: Db,
  bugId: string,
  userIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  await db.issueWatch.createMany({
    data: ids.map((userId) => ({ userId, bugId, watching: true })),
    skipDuplicates: true,
  });
}

import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Reading a person's balance straight off the ledger (#618).
 *
 * A balance is only ever the sum of their `PointEntry` rows inside one tenant:
 * corrections included, nothing derived from the issue tables. That keeps it
 * reproducible — the same rows always give the same number — which is what a
 * later token transfer would have to start from.
 *
 * `lifetime` is every row up to now. `period` is the same sum bounded by
 * `from`/`to` when they are given, and identical to `lifetime` when they are
 * not, so a caller that doesn't care about periods still gets one shape back.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type PointPeriodTotals = {
  points: number;
  entries: number;
  /** Inclusive lower bound, ISO-8601. Null: unbounded. */
  from: string | null;
  /** Inclusive upper bound, ISO-8601. Null: unbounded (up to now). */
  to: string | null;
};

export type PointBalance = {
  lifetime: PointPeriodTotals;
  period: PointPeriodTotals;
};

export type PointBalanceQuery = {
  tenantId: string;
  userId: string;
  /** Inclusive lower bound on `PointEntry.createdAt`. */
  from?: Date | string | null;
  /** Inclusive upper bound on `PointEntry.createdAt`. */
  to?: Date | string | null;
};

/** A bound the caller supplied, as a Date, or null. Rejects anything unparseable. */
function bound(value: Date | string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  let date: Date;
  let dateOnly = false;
  if (typeof value === "string") {
    dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    date = new Date(value);
  } else {
    date = value;
  }
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} must be a valid date.`);
  }
  // A date-only inclusive upper bound covers the whole UTC day, not just
  // midnight. Normalize `to` to 23:59:59.999 UTC so entries late on that day
  // are included. `from` stays at midnight (start of day).
  if (dateOnly && field === "to") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  }
  return date;
}

async function totals(
  db: Db,
  where: Prisma.PointEntryWhereInput,
): Promise<{ points: number; entries: number }> {
  const [sum, count] = await Promise.all([
    db.pointEntry.aggregate({ where, _sum: { points: true } }),
    db.pointEntry.count({ where }),
  ]);
  return { points: sum._sum.points ?? 0, entries: count };
}

/** `userId`'s balance in `tenantId`, plus the same sum over `from`/`to`. */
export async function pointBalance(db: Db, query: PointBalanceQuery): Promise<PointBalance> {
  const { tenantId, userId } = query;
  const from = bound(query.from, "from");
  const to = bound(query.to, "to");
  if (from && to && from.getTime() > to.getTime()) {
    throw new Error("from must not be after to.");
  }

  const base = { tenantId, userId } satisfies Prisma.PointEntryWhereInput;
  const isBounded = from !== null || to !== null;
  const periodWhere: Prisma.PointEntryWhereInput = isBounded
    ? {
        ...base,
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      }
    : base;

  const [lifetime, bounded] = await Promise.all([
    totals(db, base),
    isBounded ? totals(db, periodWhere) : Promise.resolve(null),
  ]);
  const period = bounded ?? lifetime;

  return {
    lifetime: { ...lifetime, from: null, to: null },
    period: {
      ...period,
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
    },
  };
}

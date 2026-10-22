import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { defaultProjectIdFor } from "@/lib/tenant-context";
import { projectAreaFilterWhere } from "@/lib/project-area-filter";

export type FeedCursor = { after: string; afterId: string };
export const FEED_PAGE_SIZE = 50;

export class FeedInputError extends Error {}

const timestampSchema = z.iso.datetime({ offset: true });

export function parseFeedCursor(params: URLSearchParams): FeedCursor | null {
  const after = params.get("after");
  const afterId = params.get("afterId");
  if (after === null && afterId === null) return null;
  if (!after || !afterId || !timestampSchema.safeParse(after).success) {
    throw new FeedInputError("Supply both after (an ISO timestamp) and afterId.");
  }
  return { after: new Date(after).toISOString(), afterId };
}

export function feedWhere(tenantId: string, projectId: string, cursor: FeedCursor | null, area: string | null = null): Prisma.BugWhereInput {
  return {
    tenantId, projectId, isDeleted: false,
    ...projectAreaFilterWhere(area),
    ...(cursor ? { OR: [
      { createdAt: { gt: new Date(cursor.after) } },
      { createdAt: new Date(cursor.after), id: { gt: cursor.afterId } },
    ] } : {}),
  };
}

/** Resolve only projects inside the caller's tenant; never trust a supplied id. */
export async function feedProject(tenantId: string, requested?: string | null) {
  const id = requested ?? await defaultProjectIdFor(prisma, tenantId);
  if (!id) return null;
  return prisma.project.findFirst({ where: { id, tenantId }, select: { id: true, name: true } });
}

export async function readFeed(tenantId: string, projectId: string, cursor: FeedCursor | null, area: string | null = null) {
  const rows = await prisma.bug.findMany({
    where: feedWhere(tenantId, projectId, cursor, area),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: FEED_PAGE_SIZE + 1,
    select: { id: true, number: true, title: true, status: true, severity: true, createdAt: true, projectId: true, areaId: true },
  });
  const issues = rows.slice(0, FEED_PAGE_SIZE);
  const last = issues.at(-1);
  return {
    issues,
    nextCursor: last ? { after: last.createdAt.toISOString(), afterId: last.id } : cursor,
    hasMore: rows.length > FEED_PAGE_SIZE,
  };
}

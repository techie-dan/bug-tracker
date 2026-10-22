import type { Prisma, PrismaClient, TenantJoinRequestStatus } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export const TENANT_DESCRIPTION_MAX = 500;
export const TENANT_JOIN_REQUEST_RATE_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 };

/**
 * True when this name is the column or table Postgres says is missing.
 * A query that merely mentions the name does not count.
 */
function schemaGap(error: unknown, name: string): boolean {
  const message = error instanceof Error ? error.message : "";
  const meta =
    error !== null && typeof error === "object" && "meta" in error
      ? (error as { meta?: { column?: unknown; table?: unknown; modelName?: unknown } }).meta
      : undefined;
  const metaText = [meta?.column, meta?.table, meta?.modelName]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(?:^|[\\s"'\`.])${escaped}(?:$|[\\s"'\`.])`, "i").test(metaText)) return true;
  return new RegExp(
    `(?:column|table|relation) [\`'\"]?(?:[\\w."]+\\.)?${escaped}[\`'\"]? does not exist`,
    "i",
  ).test(message);
}

function discoveryUnavailable(error: unknown): boolean {
  return schemaGap(error, "description") || schemaGap(error, "discoverable") || schemaGap(error, "TenantJoinRequest");
}

export type TenantJoinRequestResult =
  | { ok: true; requestId: string; tenantId: string; tenantName: string; slug: string; created: boolean }
  | { ok: false; error: string };

export type TenantSummary = {
  description: string | null;
  discoverable: boolean;
  memberships: number;
  projects: number;
};

/**
 * Counts for the tenant page, plus discovery fields when that migration is in.
 * A database that has not added those columns still returns the counts.
 */
export async function tenantSummary(db: Db, tenantId: string): Promise<TenantSummary | null> {
  try {
    const row = await db.tenant.findUnique({
      where: { id: tenantId },
      select: {
        description: true,
        discoverable: true,
        _count: { select: { memberships: true, projects: true } },
      },
    });
    if (!row) return null;
    return {
      description: row.description,
      discoverable: row.discoverable,
      memberships: row._count.memberships,
      projects: row._count.projects,
    };
  } catch (error) {
    if (!schemaGap(error, "description") && !schemaGap(error, "discoverable")) throw error;
    console.error("[tenant] discovery columns are missing", error);
    const row = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { _count: { select: { memberships: true, projects: true } } },
    });
    if (!row) return null;
    return {
      description: null,
      discoverable: false,
      memberships: row._count.memberships,
      projects: row._count.projects,
    };
  }
}

/** Public workspace details are returned only for opted-in tenants. */
export async function discoverableTenants(db: Db, userId: string) {
  try {
    const rows = await db.tenant.findMany({
      where: { discoverable: true, memberships: { none: { userId } } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        memberships: {
          where: { role: "owner" },
          take: 1,
          select: { userId: true },
          orderBy: { createdAt: "asc" },
        },
        joinRequests: {
          where: { userId },
          select: { status: true, requestedAt: true },
        },
      },
      orderBy: { name: "asc" },
    });
    const ownerIds = [
      ...new Set(
        rows.flatMap((row) => {
          const userId = row.memberships?.[0]?.userId;
          return userId ? [userId] : [];
        }),
      ),
    ];
    const owners =
      ownerIds.length === 0
        ? []
        : await db.user.findMany({
            where: { id: { in: ownerIds } },
            select: { id: true, name: true },
          });
    const byId = new Map(owners.map((owner) => [owner.id, owner]));
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      joinRequests: row.joinRequests,
      memberships: (row.memberships ?? []).flatMap((membership) => {
        const user = byId.get(membership.userId);
        return user ? [{ user: { name: user.name } }] : [];
      }),
    }));
  } catch (error) {
    if (!discoveryUnavailable(error)) throw error;
    console.error("[tenant] workspace discovery is unavailable", error);
    return [];
  }
}

export async function requestsForUser(db: Db, userId: string) {
  try {
    return await db.tenantJoinRequest.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        requestedAt: true,
        tenant: { select: { id: true, name: true, slug: true, discoverable: true } },
      },
      orderBy: { requestedAt: "desc" },
    });
  } catch (error) {
    if (!discoveryUnavailable(error)) throw error;
    console.error("[tenant] join requests are unavailable", error);
    return [];
  }
}

/** Pending requests whose account still exists. A missing user is skipped, not fatal. */
export async function pendingTenantJoinRequests(db: Db, tenantId: string) {
  let rows: { id: string; requestedAt: Date; userId: string }[];
  try {
    rows = await db.tenantJoinRequest.findMany({
      where: { tenantId, status: "pending" },
      select: { id: true, requestedAt: true, userId: true },
      orderBy: { requestedAt: "asc" },
    });
  } catch (error) {
    if (!discoveryUnavailable(error)) throw error;
    console.error("[tenant] join requests are unavailable", error);
    return [];
  }
  if (rows.length === 0) return [];
  const people = await db.user.findMany({
    where: { id: { in: rows.map((row) => row.userId) } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(people.map((person) => [person.id, person]));
  return rows.flatMap((row) => {
    const user = byId.get(row.userId);
    return user ? [{ id: row.id, requestedAt: row.requestedAt, user }] : [];
  });
}

/** Creates or reopens the unique request for this person and workspace. */
export async function requestTenantMembership(
  db: Db,
  userId: string,
  tenantId: string,
  now = new Date(),
): Promise<TenantJoinRequestResult> {
  if (!tenantId) return { ok: false, error: "Choose a workspace." };
  if (await db.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { id: true } })) {
    return { ok: false, error: "You already belong to this workspace." };
  }

  const tenant = await db.tenant.findFirst({
    where: { id: tenantId, discoverable: true },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) return { ok: false, error: "This workspace is not accepting join requests." };

  const existing = await db.tenantJoinRequest.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { id: true, status: true },
  });
  if (existing?.status === "pending") {
    return { ok: true, requestId: existing.id, tenantId: tenant.id, tenantName: tenant.name, slug: tenant.slug, created: false };
  }

  let request: { id: string };
  try {
    request = existing
      ? await db.tenantJoinRequest.update({
          where: { id: existing.id },
          data: { status: "pending", requestedAt: now, reviewedAt: null, reviewedById: null },
          select: { id: true },
        })
      : await db.tenantJoinRequest.create({
          data: { tenantId, userId, requestedAt: now },
          select: { id: true },
        });
  } catch (error) {
    // Two simultaneous requests may both observe no row. The unique key makes
    // the losing insert harmless; read back the winner as the pending result.
    const duplicate = await db.tenantJoinRequest.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { id: true, status: true },
    });
    if (duplicate?.status === "pending") {
      return { ok: true, requestId: duplicate.id, tenantId: tenant.id, tenantName: tenant.name, slug: tenant.slug, created: false };
    }
    throw error;
  }
  return { ok: true, requestId: request.id, tenantId: tenant.id, tenantName: tenant.name, slug: tenant.slug, created: true };
}

export type ReviewTenantJoinRequestResult =
  | { ok: true; status: TenantJoinRequestStatus; requestId: string; tenantId: string; tenantName: string; slug: string; userId: string; userName: string }
  | { ok: false; error: string };

/** A pending request is the only state transition that can create membership. */
export async function reviewTenantMembershipRequest(
  db: PrismaClient,
  input: { requestId: string; reviewerId: string; status: "approved" | "rejected" },
): Promise<ReviewTenantJoinRequestResult> {
  const request = await db.tenantJoinRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      status: true,
      tenant: { select: { name: true, slug: true } },
      user: { select: { name: true, email: true } },
    },
  });
  if (!request || request.status !== "pending") return { ok: false, error: "This request is no longer pending." };

  const changed = await db.$transaction(async (tx) => {
    const update = await tx.tenantJoinRequest.updateMany({
      where: { id: request.id, status: "pending" },
      data: { status: input.status, reviewedAt: new Date(), reviewedById: input.reviewerId },
    });
    if (update.count !== 1) return false;
    if (input.status === "approved") {
      await tx.membership.createMany({
        data: [{ tenantId: request.tenantId, userId: request.userId, role: "member" }],
        skipDuplicates: true,
      });
    }
    return true;
  });
  if (!changed) return { ok: false, error: "This request was already reviewed." };

  return {
    ok: true,
    status: input.status,
    requestId: request.id,
    tenantId: request.tenantId,
    tenantName: request.tenant.name,
    slug: request.tenant.slug,
    userId: request.userId,
    userName: request.user.name ?? request.user.email,
  };
}

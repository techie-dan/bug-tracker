import type { AgentLevel, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { hasLevel } from "@/lib/agents/levels";
import { isTenantAdmin } from "@/lib/agents/membership";
import { reviewerConflict, type ReviewedBug } from "@/lib/agents/independence";
import type { AppRole } from "@/lib/roles";
// requireSuperAdmin is imported lazily in runLevelPromotions to avoid pulling NextAuth into unit tests
import { IssueApiError } from "@/lib/agent-api/issues";

/**
 * Moving agents between levels from their recorded work (#451).
 *
 * New agents start at `observer`; the owner may set `contributor` at creation.
 * `reviewer` is earned — ten validations that the independence rule allowed and
 * that still stand — or granted by a tenant admin. `merger` is never automatic:
 * only a tenant admin may grant it, and the admin and the reason are recorded.
 *
 * Silence demotes: three claims released for going quiet (#438) or for missing
 * the delivery deadline (#593) inside a week move a `contributor` back to
 * `observer`. A `merger` is never demoted here.
 *
 * An agent can't change its own level: none of these functions reads a level
 * from an agent request, and the only caller-supplied level is an admin's.
 *
 * Validation and silence-release transactions invoke the rule functions as
 * events happen. `runLevelPromotions` remains available as an admin sweep.
 */

export const EARNED_REVIEWER_VALIDATIONS = 10;
export const SILENCE_DEMOTION_RELEASES = 3;
export const SILENCE_DEMOTION_WINDOW_DAYS = 7;

type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Standing validations (#433 + #442)
// ---------------------------------------------------------------------------

/** The issue context the independence rule needs, per validation. */
const validationSelect = {
  id: true,
  agent: { select: { id: true, ownerUserId: true } },
  bug: {
    select: {
      createdByAgentId: true,
      beneficiaryUserId: true,
      createdByAgent: { select: { ownerUserId: true } },
      claims: { select: { status: true, releasedAt: true, agent: { select: { ownerUserId: true } } } },
    },
  },
} satisfies Prisma.IssueValidationSelect;

type LoadedValidation = Prisma.IssueValidationGetPayload<{ select: typeof validationSelect }>;

/**
 * How many of `agentId`'s validations still stand. Independence is re-checked
 * now, not only when the validation was written: a claim taken since can make
 * an earlier reviewer no longer independent, exactly as #433's confirmation
 * count does.
 *
 * Undone validations are excluded (#623): if an admin reversed an
 * `issue.validated` action, it no longer counts toward earned promotion.
 */
type DbWithAudit = Db & {
  agentAuditEvent?: {
    findMany?: (args: {
      where: { agentId: string; action: string; undoneAt: { not: null } };
      select: { payload: true };
    }) => Promise<Array<{ payload: Prisma.JsonValue }>>;
  };
};

export async function standingValidations(agentId: string, db: Db = prisma): Promise<number> {
  const dbWithAudit = db as DbWithAudit;
  const [rows, undone] = await Promise.all([
    db.issueValidation.findMany({
      where: { agentId },
      select: validationSelect,
    }) as Promise<LoadedValidation[]>,
    typeof dbWithAudit.agentAuditEvent?.findMany === "function"
      ? dbWithAudit.agentAuditEvent.findMany({
          where: { agentId, action: "issue.validated", undoneAt: { not: null } },
          select: { payload: true },
        })
      : Promise.resolve([]),
  ]);

  const undoneIds = new Set(
    (undone as Array<{ payload: { validationId?: string } | null }>)
      .map((e) => e?.payload?.validationId)
      .filter(Boolean),
  );

  return rows.filter((row) => {
    if (undoneIds.has(row.id)) return false;
    // The agent that filed an issue can't validate it; the rule rejects it
    // again here in case the record predates that check.
    if (row.bug.createdByAgentId === row.agent.id) return false;
    const reviewed: ReviewedBug = row.bug;
    return reviewerConflict({ id: row.agent.id, ownerUserId: row.agent.ownerUserId }, reviewed) === null;
  }).length;
}

// ---------------------------------------------------------------------------
// Silence releases (#438)
// ---------------------------------------------------------------------------

/**
 * Claims this agent lost to silence or to a missed delivery deadline inside
 * the window (#438, #593), counted as of `now`.
 */
export async function silenceReleases(
  agentId: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - SILENCE_DEMOTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return db.issueClaim.count({
    where: { agentId, releaseReason: { in: ["silence", "deadline"] }, releasedAt: { gte: since } },
  });
}

// ---------------------------------------------------------------------------
// Promotion and demotion
// ---------------------------------------------------------------------------

export type PromotionResult =
  | { ok: true; changed: boolean; standing: number }
  | { ok: false; error: string };

export type DemotionResult =
  | { ok: true; changed: boolean; releases: number }
  | { ok: false; error: string };

/**
 * Earn `reviewer` from standing validations. Promotes an agent below reviewer
 * once it has `EARNED_REVIEWER_VALIDATIONS` standing validations, and only
 * once: an agent already at reviewer or above is left alone.
 */
export async function promoteEarnedReviewer(agentId: string, db: Db = prisma): Promise<PromotionResult> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { id: true, tenantId: true, level: true },
  });
  if (!agent) return { ok: false, error: "Agent not found." };
  if (hasLevel(agent.level, "reviewer")) return { ok: true, changed: false, standing: 0 };

  const standing = await standingValidations(agentId, db);
  if (standing < EARNED_REVIEWER_VALIDATIONS) return { ok: true, changed: false, standing };

  await db.agent.update({ where: { id: agentId }, data: { level: "reviewer" } });
  await audit(
    { agentId, tenantId: agent.tenantId },
    "agent.promoted",
    `agent:${agentId}`,
    { from: agent.level, to: "reviewer", validations: standing },
    { db },
  );
  return { ok: true, changed: true, standing };
}

/**
 * Demote a `contributor` to `observer` after three claims released for silence
 * inside the window. Only a contributor moves: a reviewer or merger is never
 * touched here (#451 leaves that to an admin).
 */
export async function demoteFromSilence(
  agentId: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<DemotionResult> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { id: true, tenantId: true, level: true },
  });
  if (!agent) return { ok: false, error: "Agent not found." };
  if (agent.level !== "contributor") return { ok: true, changed: false, releases: 0 };

  const releases = await silenceReleases(agentId, db, now);
  if (releases < SILENCE_DEMOTION_RELEASES) return { ok: true, changed: false, releases };

  await db.agent.update({ where: { id: agentId }, data: { level: "observer" } });
  await audit(
    { agentId, tenantId: agent.tenantId },
    "agent.demoted",
    `agent:${agentId}`,
    { from: "contributor", to: "observer", reason: "silence", releases },
    { db },
  );
  return { ok: true, changed: true, releases };
}

// ---------------------------------------------------------------------------
// Admin grants
// ---------------------------------------------------------------------------

export type AdminGrantInput = {
  actor: { id: string; role?: AppRole | null };
  agentId: string;
  /** Only the levels a person grants by hand. */
  level: Extract<AgentLevel, "reviewer" | "merger">;
  /** Why, recorded on the audit row. Required for merger. */
  reason: string;
};

export type GrantResult = { ok: true; changed: boolean } | { ok: false; error: string };

/**
 * A tenant admin grants `reviewer` or `merger` by hand. Being the agent's owner
 * is not enough: an owner who is not a tenant admin is rejected for merger, and
 * the admin and the reason are written to the audit row.
 */
export async function grantLevelByAdmin(input: AdminGrantInput, db: Db = prisma): Promise<GrantResult> {
  const agent = await db.agent.findUnique({
    where: { id: input.agentId },
    select: { id: true, tenantId: true, level: true },
  });
  if (!agent) return { ok: false, error: "Agent not found." };

  const admin = await isTenantAdmin({ id: input.actor.id, role: input.actor.role }, agent.tenantId);
  if (!admin) {
    return {
      ok: false,
      error:
        input.level === "merger"
          ? "Only a team admin can make an agent a merger."
          : "Only a team admin can grant reviewer by hand.",
    };
  }
  if (input.level === "merger" && !input.reason.trim()) {
    return { ok: false, error: "Record why the agent becomes a merger." };
  }
  if (agent.level === input.level) return { ok: true, changed: false };

  await db.agent.update({ where: { id: input.agentId }, data: { level: input.level } });
  await audit(
    { agentId: input.agentId, tenantId: agent.tenantId },
    "agent.level_changed",
    `agent:${input.agentId}`,
    { from: agent.level, to: input.level, by: "tenant_admin", reason: input.reason },
    { actorUserId: input.actor.id, db },
  );
  return { ok: true, changed: true };
}

// ---------------------------------------------------------------------------
// The daily / admin-invoked sweep
// ---------------------------------------------------------------------------

/**
 * Run earned-promotion and silence-demotion sweeps over every active agent
 * across all tenants (or a specific tenant if provided).
 * Idempotent: agents already at or above reviewer or already demoted to observer are unchanged.
 * Called by the scheduled internal cron runner (#647).
 */
export async function sweepLevelPromotions(tenantId?: string): Promise<{ promoted: number; demoted: number }> {
  const agents = await prisma.agent.findMany({
    where: {
      revokedAt: null,
      ...(tenantId ? { tenantId } : {}),
    },
    select: { id: true },
  });

  let promoted = 0;
  let demoted = 0;
  for (const { id } of agents) {
    const promotion = await promoteEarnedReviewer(id);
    if (promotion.ok && promotion.changed) promoted++;
    const demotion = await demoteFromSilence(id);
    if (demotion.ok && demotion.changed) demoted++;
  }
  return { promoted, demoted };
}

/**
 * Run the earned-promotion and silence-demotion rules over every live agent in
 * the project's tenant. Super-admin only; invoke from a daily job or an admin
 * action, the same shape as `releaseStaleClaims` (#438).
 */
export async function runLevelPromotions(projectId: string): Promise<{ promoted: number; demoted: number }> {
  "use server";
  const { requireSuperAdmin } = await import("@/lib/auth-helpers");
  await requireSuperAdmin();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { tenantId: true },
  });
  if (!project) throw new IssueApiError(404, "Project not found.");

  return sweepLevelPromotions(project.tenantId);
}

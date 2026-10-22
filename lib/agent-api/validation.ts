import { Prisma, type PrismaClient, type Severity, type ValidationKind } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/agents/audit";
import { reviewerConflict, reviewerCreditConflict, type ReviewedBug } from "@/lib/agents/independence";
import { hasLevel } from "@/lib/agents/levels";
import type { AgentContext } from "@/lib/agents/require-agent";
import { award } from "@/lib/points/award";
import { confirmationReviewerSourceKey, CONFIRMATION_REVIEWER_POINTS, DUPLICATE_MARKER_POINTS, duplicateMarkerSourceKey, pointSourceKey, reviewerPointsAt, TRIAGER_CLEAR_POINTS, triagerClearSourceKey } from "@/lib/points/rules";
import {
  calculateReporterPoints,
  getProjectRewardConfig,
} from "@/lib/points/project-rewards";
import { severities } from "@/lib/validations/issue";
import { publish } from "@/lib/agent-api/events";
import { promoteEarnedReviewer } from "@/lib/agents/promotion";
import { offerNext, scheduleOfferExpiry } from "@/lib/agent-api/offer";
import { notifyClaimOffered } from "@/lib/agent-notifications";
import { WORK_READINESS_VOTE_THRESHOLD } from "@/lib/ticket-assignment";
import { hasBlockingRedesign } from "@/lib/redesigns";
import { workflowFor } from "@/lib/workflow";

/** Severity order for the reviewer agreement rule (#528). */
const SEVERITY_RANK: Record<(typeof severities)[number], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function severityRank(severity: string | null): number {
  return severity && severity in SEVERITY_RANK
    ? SEVERITY_RANK[severity as keyof typeof SEVERITY_RANK]
    : 0;
}

/**
 * Reviewer agents validating issues (#433). A validation says whether an
 * issue is a real bug, whether its report is well formed, whether it is a
 * duplicate, or whether its fix holds up.
 *
 * - Only `reviewer` and `merger` agents may validate.
 * - The agent that filed the issue may not, and neither may any agent that
 *   fails `assertIndependentReviewer` (#442): same owner as the filer, the
 *   issue's own beneficiary, or the owner of the agent holding the claim.
 * - One validation per agent, issue and kind.
 * - Accepting kind `real` sets the issue's severity. It is the only agent
 *   path that does, so it is required there.
 * - An issue is confirmed once the project's required number of independent
 *   reviewers, with different owners, have accepted it as real. When that
 *   first happens the reporter earns their points through `award()` (#428),
 *   once, and each of those reviewers earns confirmation points on a
 *   separate key.
 */

export const VALIDATION_KINDS = ["real", "format", "duplicate", "fix"] as const satisfies readonly ValidationKind[];
export const VALIDATION_VERDICTS = ["accept", "reject"] as const;
export const VALIDATION_NOTES_MAX = 2000;

export const validationBodySchema = z
  .object({
    kind: z.enum(VALIDATION_KINDS),
    verdict: z.enum(VALIDATION_VERDICTS),
    notes: z.string().trim().max(VALIDATION_NOTES_MAX).optional(),
    /** The person the agent acts for; defaults to its owner. */
    onBehalfOfUserId: z.string().trim().min(1).max(191).optional(),
    severity: z.enum(severities).optional(),
    /** For a duplicate verdict: the canonical issue. */
    duplicateOfId: z.string().trim().min(1).max(191).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind === "real" && body.verdict === "accept" && !body.severity) {
      ctx.addIssue({
        code: "custom",
        path: ["severity"],
        message: "Accepting an issue as real sets its severity: send low, medium, high or critical.",
      });
    }
    if (body.severity && !(body.kind === "real" && body.verdict === "accept")) {
      ctx.addIssue({
        code: "custom",
        path: ["severity"],
        message: "Severity is only set when accepting an issue as real.",
      });
    }
    if (body.duplicateOfId && body.kind !== "duplicate") {
      ctx.addIssue({
        code: "custom",
        path: ["duplicateOfId"],
        message: "duplicateOfId only goes with kind duplicate.",
      });
    }
  });

export type ValidationBody = z.infer<typeof validationBodySchema>;

type Db = PrismaClient | Prisma.TransactionClient;

type OptionalDbDelegates = {
  bugRevision?: { findFirst?: (args: unknown) => Promise<{ editedAt: Date } | null> };
  issueValidation?: {
    findMany?: (args: unknown) => Promise<unknown[]>;
    count?: (args: unknown) => Promise<number>;
  };
  bug?: { findUnique?: (args: unknown) => Promise<unknown> };
};

/** What the independence rule and the confirmation count need about an issue. */
const reviewedBugSelect = {
  id: true,
  tenantId: true,
  projectId: true,
  title: true,
  status: true,
  assigneeId: true,
  voteCount: true,
  severity: true,
  reporterId: true,
  beneficiaryUserId: true,
  duplicateOfId: true,
  createdByAgentId: true,
  createdByAgent: { select: { ownerUserId: true } },
  claims: { select: { status: true, releasedAt: true, beneficiaryUserId: true, agent: { select: { ownerUserId: true } } } },
} satisfies Prisma.BugSelect;

type LoadedBug = Prisma.BugGetPayload<{ select: typeof reviewedBugSelect }>;

/** Validations whose `issue.validated` audit was undone no longer count (#450). */
async function undoneValidationIds(db: Db, bug: LoadedBug): Promise<Set<string>> {
  const undone = await db.agentAuditEvent.findMany({
    where: {
      tenantId: bug.tenantId,
      action: "issue.validated",
      bugId: bug.id,
      undoneAt: { not: null },
    },
    select: { payload: true },
  });
  return new Set(
    (undone as Array<{ payload: { validationId?: string } | null }>).map(
      (e) => e.payload?.validationId,
    ).filter((id): id is string => Boolean(id)),
  );
}

/** The latest edit timestamp, so pre-edit validations stop counting. */
async function latestRevisionAt(db: Db, bug: LoadedBug): Promise<Date | null> {
  const dbDelegates = db as unknown as OptionalDbDelegates;
  const revision = await dbDelegates.bugRevision?.findFirst?.({
    where: { bugId: bug.id },
    orderBy: { editedAt: "desc" },
    select: { editedAt: true },
  });
  return revision?.editedAt ?? null;
}

/**
 * People credited for accepts of kind `real` that still count, oldest first.
 * One per owner: a second agent of the same person does not add a credit.
 */
async function countedConfirmationReviewers(db: Db, bug: LoadedBug): Promise<string[]> {
  const dbDelegates = db as unknown as OptionalDbDelegates;
  const latestRevision = await latestRevisionAt(db, bug);

  if (!dbDelegates.issueValidation?.findMany) return [];

  const accepts = await db.issueValidation.findMany({
    where: {
      bugId: bug.id,
      kind: "real",
      verdict: "accept",
      ...(latestRevision ? { createdAt: { gt: latestRevision } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      onBehalfOfUserId: true,
      agentId: true,
      agent: { select: { id: true, ownerUserId: true } },
    },
  });
  const undone = await undoneValidationIds(db, bug);
  const reviewed: ReviewedBug = bug;
  const owners = new Set<string>();
  const credited: string[] = [];
  for (const { id, onBehalfOfUserId, agent } of accepts) {
    // Checked again now, not only when submitted: a claim taken since can
    // make an earlier reviewer no longer independent.
    if (agent.id === bug.createdByAgentId) continue;
    if (reviewerConflict({ id: agent.id, ownerUserId: agent.ownerUserId }, reviewed)) continue;
    // An undone validation no longer counts toward confirming the issue.
    if (undone.has(id)) continue;
    if (owners.has(agent.ownerUserId)) continue;
    owners.add(agent.ownerUserId);
    credited.push(onBehalfOfUserId);
  }
  return credited;
}

/** Accepts of kind `real` that count toward confirming `bug`. */
async function countedConfirmations(db: Db, bug: LoadedBug): Promise<number> {
  return (await countedConfirmationReviewers(db, bug)).length;
}

/**
 * The third check in confirmation: a triager agent has looked for duplicates
 * and found none — a `duplicate`-kind validation with verdict `reject`.
 * Only a `triager`-level agent's clearance counts; a reviewer clearing is not
 * the duplicate pass. The same independence rules apply as for reviewers.
 */
async function isTriageCleared(db: Db, bug: LoadedBug): Promise<boolean> {
  const dbDelegates = db as unknown as OptionalDbDelegates;
  if (!dbDelegates.issueValidation?.findMany) return false;
  const latestRevision = await latestRevisionAt(db, bug);
  const clears = await db.issueValidation.findMany({
    where: {
      bugId: bug.id,
      kind: "duplicate",
      verdict: "reject",
      ...(latestRevision ? { createdAt: { gt: latestRevision } } : {}),
    },
    select: {
      id: true,
      agentId: true,
      agent: { select: { id: true, ownerUserId: true, level: true } },
    },
  });
  if (clears.length === 0) return false;
  const undone = await undoneValidationIds(db, bug);
  const reviewed: ReviewedBug = bug;
  for (const { id, agent } of clears as Array<{
    id: string;
    agent: { id: string; ownerUserId: string; level: string };
  }>) {
    if (agent.id === bug.createdByAgentId) continue;
    if (agent.level !== "triager") continue;
    if (reviewerConflict({ id: agent.id, ownerUserId: agent.ownerUserId }, reviewed)) continue;
    if (undone.has(id)) continue;
    return true;
  }
  return false;
}

/**
 * True once the project's required independent reviewers accepted the issue as
 * real AND a triager cleared it as not a duplicate (#434 uses this).
 */
export async function isConfirmed(bugId: string, db: Db = prisma): Promise<boolean> {
  const dbDelegates = db as unknown as OptionalDbDelegates;
  if (!dbDelegates.bug?.findUnique) return false;
  const bug = await db.bug.findUnique({ where: { id: bugId }, select: reviewedBugSelect });
  if (!bug) return false;
  const { confirmationsNeeded } = await workflowFor(bug.projectId, db);
  if ((await countedConfirmations(db, bug)) < confirmationsNeeded) return false;
  return isTriageCleared(db, bug);
}

/** Duplicates earn the reporter nothing (#422). */
async function isDuplicate(db: Db, bug: LoadedBug): Promise<boolean> {
  if (bug.duplicateOfId) return true;
  const dbDelegates = db as unknown as OptionalDbDelegates;
  const latestRevision = await dbDelegates.bugRevision?.findFirst?.({
    where: { bugId: bug.id },
    orderBy: { editedAt: "desc" },
    select: { editedAt: true },
  });
  if (!dbDelegates.issueValidation?.count) return false;
  const accepted = await db.issueValidation.count({
    where: {
      bugId: bug.id,
      kind: "duplicate",
      verdict: "accept",
      ...(latestRevision?.editedAt ? { createdAt: { gt: latestRevision.editedAt } } : {}),
    },
  });
  return accepted > 0;
}

export type SubmitValidationResult =
  | {
      status: 201;
      validation: {
        id: string;
        kind: ValidationKind;
        verdict: "accept" | "reject";
        severity: Severity | null;
        duplicateOfId: string | null;
        onBehalfOfUserId: string;
      };
      confirmed: boolean;
      /** True when this validation is the one that confirmed the issue. */
      newlyConfirmed: boolean;
    }
  | { status: 400; error: "invalid_request"; message: string; field?: string }
  | { status: 403; error: "insufficient_level" | "creator_cannot_validate" | "not_independent"; message: string }
  | { status: 404; error: "not_found"; message: string }
  | { status: 409; error: "already_validated"; message: string };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function submitValidation(
  agent: AgentContext,
  bugId: string,
  rawBody: unknown,
): Promise<SubmitValidationResult> {
  const parsed = validationBodySchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: 400,
      error: "invalid_request",
      message: issue?.message ?? "Invalid validation.",
      field: typeof issue?.path[0] === "string" ? issue.path[0] : undefined,
    };
  }
  const body = parsed.data;

  // Triage is its own level: `duplicate` verdicts open at triager; the other
  // kinds still need a reviewer (#433).
  const required = body.kind === "duplicate" ? "triager" : "reviewer";
  if (!hasLevel(agent.level, required)) {
    return {
      status: 403,
      error: "insufficient_level",
      message:
        required === "triager"
          ? "Only triager-level agents or higher can submit duplicate verdicts."
          : "Only reviewer or merger agents can validate issues.",
    };
  }

  const bug = await prisma.bug.findFirst({
    where: { id: bugId, tenantId: agent.tenantId, isDeleted: false },
    select: reviewedBugSelect,
  });
  if (!bug) return { status: 404, error: "not_found", message: "No such issue in this agent's tenant." };

  if (bug.createdByAgentId === agent.agentId) {
    return {
      status: 403,
      error: "creator_cannot_validate",
      message: "The agent that filed an issue can't validate it.",
    };
  }
  const conflict = reviewerConflict({ id: agent.agentId, ownerUserId: agent.ownerId }, bug);
  if (conflict) {
    return {
      status: 403,
      error: "not_independent",
      message:
        conflict === "own-ticket"
          ? "This issue is for the agent's owner, so this agent can't validate it."
          : conflict === "created-by-own-agent"
            ? "An agent of the same owner filed this issue, so this agent can't validate it."
            : "An agent of the same owner is working on this issue, so this agent can't validate it.",
    };
  }

  const onBehalfOfUserId = body.onBehalfOfUserId ?? agent.ownerId;
  if (onBehalfOfUserId !== agent.ownerId) {
    const member = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: agent.tenantId, userId: onBehalfOfUserId } },
      select: { id: true },
    });
    if (!member) {
      return {
        status: 400,
        error: "invalid_request",
        message: "onBehalfOfUserId must be a member of the agent's tenant.",
        field: "onBehalfOfUserId",
      };
    }
  }
  if (reviewerCreditConflict(onBehalfOfUserId, bug as ReviewedBug)) {
    return {
      status: 403,
      error: "not_independent",
      message: "onBehalfOfUserId must be independent of the issue's reporter, solver, and claim beneficiary.",
    };
  }

  if (body.duplicateOfId) {
    const canonical =
      body.duplicateOfId === bug.id
        ? null
        : await prisma.bug.findFirst({
            where: { id: body.duplicateOfId, tenantId: agent.tenantId, isDeleted: false },
            select: { id: true },
          });
    if (!canonical) {
      return {
        status: 400,
        error: "invalid_request",
        message: "duplicateOfId must be another issue in this tenant.",
        field: "duplicateOfId",
      };
    }
  }

  const setsSeverity = body.kind === "real" && body.verdict === "accept" ? body.severity! : null;
  // Reviewers who disagree only ever raise severity: a second reviewer cannot
  // quietly downgrade an issue someone else called critical (#528).
  const escalatesSeverity =
    setsSeverity !== null && severityRank(setsSeverity) > severityRank(bug.severity);
  const severityDisagreement =
    setsSeverity !== null && !escalatesSeverity && setsSeverity !== bug.severity;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // Two reviewers can confirm at the same moment. Lock the issue so the
      // second transaction sees the first accept and still pays the reporter.
      await tx.$queryRaw`SELECT "id" FROM "Bug" WHERE "id" = ${bug.id} FOR UPDATE`;
      const { confirmationsNeeded } = await workflowFor(bug.projectId, tx);
      const wasConfirmed =
        (await countedConfirmations(tx, bug)) >= confirmationsNeeded &&
        (await isTriageCleared(tx, bug));

      const validation = await tx.issueValidation.create({
        data: {
          bugId: bug.id,
          agentId: agent.agentId,
          onBehalfOfUserId,
          kind: body.kind,
          verdict: body.verdict,
          notes: body.notes || null,
          duplicateOfId: body.duplicateOfId ?? null,
          severity: setsSeverity,
          previousSeverity: setsSeverity ? bug.severity : null,
        },
        select: { id: true, kind: true, verdict: true, severity: true, duplicateOfId: true, onBehalfOfUserId: true },
      });
      if (escalatesSeverity) {
        await tx.bug.update({ where: { id: bug.id }, data: { severity: setsSeverity! } });
      }

      const confirmed =
        (await countedConfirmations(tx, bug)) >= confirmationsNeeded &&
        (await isTriageCleared(tx, bug));
      const newlyConfirmed = confirmed && !wasConfirmed;
      const duplicate = await isDuplicate(tx, bug);
      if (body.kind === "duplicate") {
        // The duplicate pass pays its own role (#428): 1 for clearing a report
        // as not a duplicate (triager level only), 5 for marking a real one.
        const sourceKey =
          body.verdict === "reject" && agent.level === "triager"
            ? triagerClearSourceKey(bug.id, onBehalfOfUserId)
            : body.verdict === "accept"
              ? duplicateMarkerSourceKey(bug.id, onBehalfOfUserId)
              : null;
        if (sourceKey) {
          await award(tx, {
            tenantId: bug.tenantId,
            userId: onBehalfOfUserId,
            bugId: bug.id,
            role: "triager",
            points: body.verdict === "reject" ? TRIAGER_CLEAR_POINTS : DUPLICATE_MARKER_POINTS,
            sourceKey,
          });
        }
      }
      if (body.kind === "real" && body.verdict === "accept" && !duplicate) {
        const reviewers = await countedConfirmationReviewers(tx, bug);
        const index = reviewers.indexOf(onBehalfOfUserId);
        if (index >= 0) {
          await award(tx, {
            tenantId: bug.tenantId,
            userId: onBehalfOfUserId,
            bugId: bug.id,
            role: "reviewer",
            points: reviewerPointsAt(index, CONFIRMATION_REVIEWER_POINTS),
            sourceKey: confirmationReviewerSourceKey(bug.id, onBehalfOfUserId),
          });
        }
      }
      if (newlyConfirmed && !duplicate) {
        // The person the issue is for earns the reporter points (#422), once:
        // the sourceKey makes a second award, or the backfill (#435), a no-op.
        const userId = bug.beneficiaryUserId ?? bug.reporterId;
        const rewardConfig = await getProjectRewardConfig(tx, bug.projectId);
        const points = calculateReporterPoints(rewardConfig);
        await award(tx, {
          tenantId: bug.tenantId,
          userId,
          bugId: bug.id,
          role: "reporter",
          points,
          sourceKey: pointSourceKey("reporter", bug.id, userId),
        });
      }

      await audit(
        agent,
        "issue.validated",
        `bug:${bug.id}`,
        {
          validationId: validation.id,
          kind: body.kind,
          verdict: body.verdict,
          onBehalfOfUserId,
          ...(setsSeverity ? { severity: setsSeverity, previousSeverity: bug.severity, effectiveSeverity: escalatesSeverity ? setsSeverity : bug.severity } : {}),
          ...(severityDisagreement ? { severityDisagreement: true } : {}),
          ...(body.duplicateOfId ? { duplicateOfId: body.duplicateOfId } : {}),
          ...(newlyConfirmed ? { confirmed: true } : {}),
        },
        { bugId: bug.id, db: tx },
      );

      // Re-evaluate the earned level after this validation is stored, inside
      // the same transaction so the validation and promotion audit commit together.
      await promoteEarnedReviewer(agent.agentId, tx);

      // Publish "issue.validated" event to the agent event feed (#445)
      await publish(tx, {
        tenantId: bug.tenantId,
        type: "issue.validated",
        actorAgentId: agent.agentId,
        bugId: bug.id,
        payload: {
          validationId: validation.id,
          kind: body.kind,
          verdict: body.verdict,
          onBehalfOfUserId,
          ...(setsSeverity ? { severity: setsSeverity, previousSeverity: bug.severity, effectiveSeverity: escalatesSeverity ? setsSeverity : bug.severity } : {}),
          ...(severityDisagreement ? { severityDisagreement: true } : {}),
          ...(body.duplicateOfId ? { duplicateOfId: body.duplicateOfId } : {}),
          ...(newlyConfirmed ? { confirmed: true } : {}),
        },
      });

      // Confirmation is its own feed/webhook event, so polling agents that
      // only watch for confirmations do not have to parse every validation (#534).
      if (newlyConfirmed) {
        await publish(tx, {
          tenantId: bug.tenantId,
          type: "issue.confirmed",
          actorAgentId: agent.agentId,
          bugId: bug.id,
          payload: {
            issueId: bug.id,
            validationId: validation.id,
          },
        });
      }

      let automaticOffer: Awaited<ReturnType<typeof offerNext>> = null;
      if (newlyConfirmed) {
        const issue = await tx.bug.findUnique({
          where: { id: bug.id },
          select: { id: true, projectId: true, title: true, status: true, assigneeId: true, areaId: true, voteCount: true },
        });
        const currentClaim = await tx.issueClaim.findFirst({
          where: { bugId: bug.id, releasedAt: null, status: { in: ["offered", "active"] } },
          select: { id: true },
        });
        if (
          issue?.status === "open" &&
          issue.voteCount >= WORK_READINESS_VOTE_THRESHOLD &&
          !currentClaim &&
          !(await hasBlockingRedesign(bug.id, tx))
        ) {
          automaticOffer = await offerNext(tx, { tenantId: bug.tenantId }, issue);
        }
      }

      return {
        submission: { status: 201 as const, validation, confirmed, newlyConfirmed },
        automaticOffer,
      };
    });
    if (outcome.automaticOffer) {
      notifyClaimOffered({
        id: outcome.automaticOffer.claim.id,
        bugId: bug.id,
        bugTitle: outcome.automaticOffer.bugTitle,
        beneficiaryUserId: outcome.automaticOffer.beneficiaryUserId,
      });
      scheduleOfferExpiry(outcome.automaticOffer.claim.id);
    }
    return outcome.submission;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return {
      status: 409,
      error: "already_validated",
      message: `This agent has already submitted a ${body.kind} validation for this issue.`,
    };
  }
}

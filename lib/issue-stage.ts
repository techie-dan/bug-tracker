import type { Prisma, PrismaClient } from "@prisma/client";
import { reviewerConflict, type ReviewedBug } from "@/lib/agents/independence";
import { workflowFor } from "@/lib/workflow";
import { DEFAULT_PROJECT_WORKFLOW } from "@/lib/workflow-config";
import { WORK_READINESS_VOTE_THRESHOLD } from "@/lib/ticket-assignment";

/** Where an open issue sits before someone starts the work. Not a status. */
export type IssueStage = "reported" | "confirmed" | "ready";

/** List filters. `ready` is the issue that can be passed on. */
export type IssueStageView = "reported" | "confirmed" | "ready";

export const issueStageLabels: Record<IssueStage, string> = {
  reported: "Reported",
  confirmed: "Confirmed",
  ready: "Ready",
};

/**
 * An open report is an idea until reviewers accept it and it has enough
 * upvotes. Then it is an issue and can be passed on.
 */
export type Intake = "idea" | "issue";

export function parseIssueStageView(raw: string | null | undefined): IssueStageView | null {
  return raw === "reported" || raw === "confirmed" || raw === "ready" ? raw : null;
}

export function intakeOf(stage: IssueStage): Intake {
  return stage === "ready" ? "issue" : "idea";
}

export function intakeLabel(stage: IssueStage): string {
  return intakeOf(stage) === "issue" ? "Issue" : "Idea";
}

/** Idea until both gates are met, including once the report is no longer open. */
export function intakeKind(input: {
  status: string;
  voteCount: number;
  confirmed: boolean;
}): Intake {
  const stage = issueStage(input);
  if (stage) return intakeOf(stage);
  if (input.status === "in_progress" || input.status === "resolved" || input.confirmed) return "issue";
  return "idea";
}

export function intakeDetail(stage: IssueStage, voteCount: number): string {
  if (stage === "ready") {
    return "This is an issue. Reviewers accepted it and it has enough upvotes, so it can be passed on.";
  }
  if (stage === "confirmed") {
    const left = Math.max(0, WORK_READINESS_VOTE_THRESHOLD - voteCount);
    const votes = left === 1 ? "1 more upvote" : `${left} more upvotes`;
    return `This is an idea. Reviewers accepted it. It needs ${votes} before it can be passed on as an issue.`;
  }
  return "This is an idea. It becomes an issue when reviewers accept it and three people upvote it. Then it can be passed on.";
}

/**
 * Reported and confirmed are still ideas: reviewers have not accepted it, or
 * it does not yet have three upvotes.
 * Ready is an issue: both gates are met, so it can be passed on.
 * Anything no longer open has no intake tag.
 */
export function issueStage(input: {
  status: string;
  voteCount: number;
  confirmed: boolean;
}): IssueStage | null {
  if (input.status !== "open") return null;
  if (!input.confirmed) return "reported";
  if (input.voteCount < WORK_READINESS_VOTE_THRESHOLD) return "confirmed";
  return "ready";
}

type AcceptingReview = { id: string; agentId: string; ownerUserId: string };

/** Distinct independent owners who accepted the issue as real. */
export function confirmationCount(input: {
  createdByAgentId: string | null;
  accepts: readonly AcceptingReview[];
  undoneIds: ReadonlySet<string>;
  bug: ReviewedBug;
}): number {
  const owners = new Set<string>();
  for (const accept of input.accepts) {
    if (input.createdByAgentId && accept.agentId === input.createdByAgentId) continue;
    if (input.undoneIds.has(accept.id)) continue;
    if (reviewerConflict({ id: accept.agentId, ownerUserId: accept.ownerUserId }, input.bug)) continue;
    owners.add(accept.ownerUserId);
  }
  return owners.size;
}

export function isConfirmedCount(
  count: number,
  needed = DEFAULT_PROJECT_WORKFLOW.confirmationsNeeded,
): boolean {
  return count >= needed;
}

/**
 * Stage of every open issue matching `where`. A missing validation table
 * leaves the map empty so the list still renders.
 */
export async function openIssueStages(
  db: PrismaClient,
  where: Prisma.BugWhereInput,
): Promise<Map<string, IssueStage>> {
  const bugs = await db.bug.findMany({
    where: { ...where, status: "open", isDeleted: false },
    select: {
      id: true,
      projectId: true,
      status: true,
      voteCount: true,
      beneficiaryUserId: true,
      reporterId: true,
      createdByAgentId: true,
      createdByAgent: { select: { ownerUserId: true } },
      claims: {
        where: { status: "active", releasedAt: null },
        select: { status: true, releasedAt: true, agent: { select: { ownerUserId: true } } },
      },
    },
  });
  const stages = new Map<string, IssueStage>();
  if (bugs.length === 0) return stages;

  const ids = bugs.map((bug) => bug.id);
  const projectIds = [...new Set(bugs.map((bug) => bug.projectId))];
  const workflows = new Map(
    await Promise.all(projectIds.map(async (projectId) => [projectId, await workflowFor(projectId, db)] as const)),
  );
  const [revisions, validations, undone] = await Promise.all([
    db.bugRevision.findMany({
      where: { bugId: { in: ids } },
      select: { bugId: true, editedAt: true },
    }),
    db.issueValidation.findMany({
      where: { bugId: { in: ids }, kind: "real", verdict: "accept" },
      select: {
        id: true,
        bugId: true,
        createdAt: true,
        agentId: true,
        agent: { select: { ownerUserId: true } },
      },
    }),
    db.agentAuditEvent.findMany({
      where: { action: "issue.validated", bugId: { in: ids }, undoneAt: { not: null } },
      select: { bugId: true, payload: true },
    }),
  ]);

  const revisedAt = new Map<string, Date>();
  for (const revision of revisions) {
    const current = revisedAt.get(revision.bugId);
    if (!current || revision.editedAt > current) revisedAt.set(revision.bugId, revision.editedAt);
  }
  const undoneByBug = new Map<string, Set<string>>();
  for (const event of undone) {
    const validationId = (event.payload as { validationId?: string } | null)?.validationId;
    if (!validationId || !event.bugId) continue;
    const set = undoneByBug.get(event.bugId) ?? new Set<string>();
    set.add(validationId);
    undoneByBug.set(event.bugId, set);
  }
  const acceptsByBug = new Map<string, AcceptingReview[]>();
  for (const validation of validations) {
    const cutoff = revisedAt.get(validation.bugId);
    if (cutoff && validation.createdAt <= cutoff) continue;
    const list = acceptsByBug.get(validation.bugId) ?? [];
    list.push({
      id: validation.id,
      agentId: validation.agentId,
      ownerUserId: validation.agent.ownerUserId,
    });
    acceptsByBug.set(validation.bugId, list);
  }

  for (const bug of bugs) {
    const reviewed: ReviewedBug = {
      beneficiaryUserId: bug.beneficiaryUserId,
      reporterId: bug.reporterId,
      createdByAgent: bug.createdByAgent,
      claims: bug.claims,
    };
    const confirmed = isConfirmedCount(
      confirmationCount({
        createdByAgentId: bug.createdByAgentId,
        accepts: acceptsByBug.get(bug.id) ?? [],
        undoneIds: undoneByBug.get(bug.id) ?? new Set(),
        bug: reviewed,
      }),
      workflows.get(bug.projectId)?.confirmationsNeeded ?? DEFAULT_PROJECT_WORKFLOW.confirmationsNeeded,
    );
    const stage = issueStage({ status: bug.status, voteCount: bug.voteCount, confirmed });
    if (stage) stages.set(bug.id, stage);
  }
  return stages;
}

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { IssueApiError } from "@/lib/agent-api/issues";
import { isConfirmed } from "@/lib/agent-api/validation";
import { publish } from "@/lib/agent-api/events";
import { offerNext, scheduleOfferExpiry } from "@/lib/agent-api/offer";
import { awardBid } from "@/lib/agent-api/bid";
import { notifyClaimOffered } from "@/lib/agent-notifications";
import { WORK_READINESS_VOTE_THRESHOLD } from "@/lib/ticket-assignment";

const id = z.string().trim().min(1).max(191);

/**
 * Dispatcher assignment policy.
 */
export type DispatcherPolicy = "offer_only" | "auto_award" | "direct_assign";

export const dispatcherPolicySchema = z.enum(["offer_only", "auto_award", "direct_assign"]);

export const dispatcherConfigSchema = z.object({
  projectId: id.optional(),
  policy: dispatcherPolicySchema.optional(),
  autoAwardAfterHours: z.number().int().min(1).max(168).optional(),
  maxOffersPerRun: z.number().int().min(1).max(100).optional(),
});

export type DispatcherConfig = z.infer<typeof dispatcherConfigSchema>;

/**
 * A ready issue: confirmed, has 3+ upvotes, and has no active claim.
 */
export type ReadyIssue = {
  id: string;
  number: number;
  title: string;
  projectId: string;
  areaId: string | null;
  voteCount: number;
  assigneeId: string | null;
  createdAt: Date;
};

/**
 * Scan for ready issues in a project.
 */
export async function findReadyIssues(
  agent: AgentContext,
  projectId: string,
  limit = 50
): Promise<ReadyIssue[]> {
  requireLevel(agent, "dispatcher");

  const ready: ReadyIssue[] = [];
  let cursor: string | undefined;
  while (ready.length < limit) {
    const issues = await prisma.bug.findMany({
      where: {
        tenantId: agent.tenantId,
        projectId,
        isDeleted: false,
        status: "open",
        voteCount: { gte: WORK_READINESS_VOTE_THRESHOLD },
        claims: {
          none: {
            releasedAt: null,
            status: { in: ["active", "offered"] },
          },
        },
      },
      select: {
        id: true,
        number: true,
        title: true,
        projectId: true,
        areaId: true,
        voteCount: true,
        assigneeId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // Filter to only confirmed issues
    for (let offset = 0; offset < issues.length && ready.length < limit; offset += 10) {
      const confirmed = await Promise.all(
        issues.slice(offset, offset + 10).map(async (issue) => ({
          ...issue,
          confirmed: await isConfirmed(issue.id),
        }))
      );
      ready.push(...confirmed.filter((issue) => issue.confirmed));
    }
    if (issues.length < 50) break;
    cursor = issues[issues.length - 1].id;
  }

  return ready.slice(0, limit);
}

/**
 * Dispatcher operation result.
 */
export type DispatcherResult = {
  offered: number;
  awarded: number;
  skipped: number;
  errors: Array<{ issueId: string; error: string }>;
};

/**
 * Automatically offer ready issues to eligible candidates.
 */
export async function dispatchReadyIssues(
  agent: AgentContext,
  projectId: string,
  config: DispatcherConfig = {}
): Promise<DispatcherResult> {
  requireLevel(agent, "dispatcher");

  const {
    policy = "offer_only",
    autoAwardAfterHours,
    maxOffersPerRun = 10,
  } = config;

  const readyIssues = await findReadyIssues(agent, projectId, maxOffersPerRun);

  const result: DispatcherResult = {
    offered: 0,
    awarded: 0,
    skipped: 0,
    errors: [],
  };

  for (const issue of readyIssues) {
    try {
      if (policy === "direct_assign") {
        // Directly assign to top candidate without offering
        await assignDirectly(agent, issue);
        result.awarded++;
      } else {
        // Check for existing bids first
        const bids = await prisma.issueBid.findMany({
          where: {
            bugId: issue.id,
            withdrawnAt: null,
            awardedAt: null,
          },
          select: {
            id: true,
            agentId: true,
            beneficiaryUserId: true,
            createdAt: true,
            bug: { select: { reporterId: true } },
          },
          orderBy: { createdAt: "asc" },
        });

        if (bids.length > 0) {
          // Pending bids belong to the reporter. Only auto_award may close one,
          // and only once the reporter has had autoAwardAfterHours to pick.
          const oldest = bids[0];
          const waitedLongEnough =
            !autoAwardAfterHours ||
            oldest.createdAt.getTime() <= Date.now() - autoAwardAfterHours * 3_600_000;
          if (policy === "auto_award" && waitedLongEnough) {
            if (!oldest.bug.reporterId) throw new IssueApiError(409, "Issue has no reporter to award the bid.");
            await awardBid({ id: oldest.bug.reporterId }, oldest.id);
            result.awarded++;
          } else {
            result.skipped++;
          }
        } else {
          // No bids: offer to the top-ranked candidate.
          if (await offerIssue(agent, issue)) result.offered++;
          else result.skipped++;
        }
      }
    } catch (error) {
      result.errors.push({
        issueId: issue.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Offer an issue to the next eligible candidate.
 */
async function offerIssue(
  agent: AgentContext,
  issue: ReadyIssue
): Promise<boolean> {
  const offerResult = await offerNext(prisma, agent, {
    id: issue.id,
    projectId: issue.projectId,
    title: issue.title,
    assigneeId: issue.assigneeId,
    areaId: issue.areaId,
  });

  if (offerResult) {
    notifyClaimOffered({
      id: offerResult.claim.id,
      bugId: issue.id,
      bugTitle: offerResult.bugTitle,
      beneficiaryUserId: offerResult.beneficiaryUserId,
    });

    scheduleOfferExpiry(offerResult.claim.id);
  }
  return Boolean(offerResult);
}

/**
 * Directly assign an issue to the top candidate (bypass bidding).
 */
async function assignDirectly(
  agent: AgentContext,
  issue: ReadyIssue
): Promise<void> {
  const offerResult = await offerNext(prisma, agent, {
    id: issue.id,
    projectId: issue.projectId,
    title: issue.title,
    assigneeId: issue.assigneeId,
    areaId: issue.areaId,
  });

  if (!offerResult) {
    throw new IssueApiError(409, "No eligible candidate available for direct assignment.");
  }

  // Accept the offer immediately to create an active claim
  const claim = await prisma.issueClaim.update({
    where: { id: offerResult.claim.id },
    data: {
      status: "active",
      claimedAt: new Date(),
      lastHeartbeatAt: new Date(),
    },
  });

  await prisma.bug.update({
    where: { id: issue.id },
    data: {
      assigneeId: offerResult.beneficiaryUserId,
      status: "in_progress",
    },
  });

  await publish(prisma, {
    tenantId: agent.tenantId,
    type: "claim.accepted",
    actorAgentId: agent.agentId,
    bugId: issue.id,
    payload: {
      claimId: claim.id,
      issueId: issue.id,
      projectId: issue.projectId,
      beneficiaryUserId: offerResult.beneficiaryUserId,
    },
  });
}

/**
 * Get dispatcher metrics for a project.
 */
export async function getDispatcherMetrics(
  agent: AgentContext,
  projectId: string
): Promise<{
  readyIssues: number;
  activeClaims: number;
  pendingOffers: number;
  openBids: number;
}> {
  requireLevel(agent, "dispatcher");

  const [readyCount, activeClaims, pendingOffers, openBids] = await Promise.all([
    findReadyIssues(agent, projectId, Number.POSITIVE_INFINITY).then((issues) => issues.length),
    prisma.issueClaim.count({
      where: {
        bug: { tenantId: agent.tenantId, projectId },
        status: "active",
        releasedAt: null,
      },
    }),
    prisma.issueClaim.count({
      where: {
        bug: { tenantId: agent.tenantId, projectId },
        status: "offered",
        releasedAt: null,
        offeredAt: { gt: new Date(Date.now() - 60_000) },
      },
    }),
    prisma.issueBid.count({
      where: {
        bug: { tenantId: agent.tenantId, projectId },
        withdrawnAt: null,
        awardedAt: null,
      },
    }),
  ]);

  return {
    readyIssues: readyCount,
    activeClaims,
    pendingOffers,
    openBids,
  };
}

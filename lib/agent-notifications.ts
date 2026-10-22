import { prisma } from "@/lib/prisma";
import { notifyLater } from "@/lib/notify";
import type { NotificationEvent } from "@/lib/notifications";

/**
 * Telling a person when an agent, or the platform, needs them (#443). Other
 * issues call the `notify*` functions from their routes; each queues one
 * in-app notification for one person, plus email under the rules in
 * lib/notify.ts. The `*Event` builders are pure so the wording and the
 * recipient can be unit-tested without a database.
 *
 * The inputs are plain shapes rather than Prisma rows, so callers pass the
 * names they already have instead of this module loading agents and tenants.
 */

type Agent = { name: string };
type Issue = { bugId?: string | null; bugTitle?: string | null };

export type AgentQuestionInput = Issue & {
  id: string;
  body: string;
  tenantId: string;
  /** The owner being asked; the only person who may answer (#446). */
  ownerUserId: string;
  agent: Agent;
  /** #606: a reminder for a question still unanswered after 30 minutes. */
  reminder?: boolean;
};

export type ApprovalInput = Issue & {
  id: string;
  title: string;
  tenantId?: string;
  /** The person the proposing agent acts for (#431). */
  onBehalfOfUserId: string;
  agent: Agent;
};

export type TenantInviteInput = {
  id: string;
  tenantName: string;
  tenantId?: string;
  /** The account the invite went to, when one exists for its email (#444). */
  inviteeUserId: string;
  invitedBy: { id: string; name: string };
};

export type ClaimOfferInput = {
  id: string;
  bugId: string;
  bugTitle: string;
  /** The person the issue is offered to (#449). */
  beneficiaryUserId: string;
};

export type MergeFailedInput = Issue & {
  /** The person the claim was for; the only one told (#452). */
  recipientId: string;
  /** Why the merge did not happen, already human-readable. */
  reason: string;
  /** The merger agent that tried, when one did. */
  agent?: Agent;
};

const EXCERPT_LENGTH = 200;

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}

export function agentQuestionEvent(question: AgentQuestionInput): NotificationEvent {
  return {
    kind: "agent_question",
    actorId: null,
    actorName: question.agent.name,
    recipientId: question.ownerUserId,
    tenantId: question.tenantId,
    questionId: question.id,
    excerpt: excerpt(question.body) || undefined,
    bugId: question.bugId ?? null,
    bugTitle: question.bugTitle ?? null,
    ...(question.reminder ? { reminder: true } : {}),
  };
}

export function approvalNeededEvent(proposal: ApprovalInput): NotificationEvent {
  return {
    kind: "approval_needed",
    actorId: null,
    actorName: proposal.agent.name,
    recipientId: proposal.onBehalfOfUserId,
    tenantId: proposal.tenantId,
    proposalId: proposal.id,
    proposalTitle: proposal.title,
    bugId: proposal.bugId ?? null,
    bugTitle: proposal.bugTitle ?? null,
  };
}

export function tenantInviteEvent(invite: TenantInviteInput): NotificationEvent {
  return {
    kind: "tenant_invite",
    actorId: invite.invitedBy.id,
    actorName: invite.invitedBy.name,
    recipientId: invite.inviteeUserId,
    tenantId: invite.tenantId,
    inviteId: invite.id,
    tenantName: invite.tenantName,
  };
}

export function claimOfferedEvent(claim: ClaimOfferInput): NotificationEvent {
  return {
    kind: "claim_offered",
    actorId: null,
    actorName: "Ziki",
    recipientId: claim.beneficiaryUserId,
    claimId: claim.id,
    bugId: claim.bugId,
    bugTitle: claim.bugTitle,
  };
}

export function mergeFailedEvent(failure: MergeFailedInput): NotificationEvent {
  return {
    kind: "merge_failed",
    actorId: null,
    actorName: failure.agent?.name ?? "Ziki",
    recipientId: failure.recipientId,
    bugId: failure.bugId ?? null,
    bugTitle: failure.bugTitle ?? null,
    reason: failure.reason,
  };
}

export function notifyAgentQuestion(question: AgentQuestionInput): void {
  notifyLater(agentQuestionEvent(question));
}

export function notifyApprovalNeeded(proposal: ApprovalInput): void {
  notifyLater(approvalNeededEvent(proposal));
}

/**
 * Invites are sent to an email address (#444). Only someone who already has
 * an account can get an in-app notification; anyone else learns of the
 * invite from the link #444 sends them.
 */
export async function notifyTenantInvite(invite: {
  id: string;
  tenantName: string;
  tenantId?: string;
  email: string;
  invitedBy: { id: string; name: string };
}): Promise<void> {
  const invitee = await prisma.user.findUnique({
    where: { email: invite.email.trim().toLowerCase() },
    select: { id: true },
  });
  if (!invitee) return;
  notifyLater(tenantInviteEvent({ ...invite, inviteeUserId: invitee.id }));
}

export function notifyClaimOffered(claim: ClaimOfferInput): void {
  notifyLater(claimOfferedEvent(claim));
}

export function notifyMergeFailed(failure: MergeFailedInput): void {
  notifyLater(mergeFailedEvent(failure));
}

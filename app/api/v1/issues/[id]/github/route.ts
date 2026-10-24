import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createReviewOffers } from "@/lib/agent-api/review-offer";
import { agentIssueRequest, issueJson } from "@/lib/agent-api/issues";
import { publish } from "@/lib/agent-api/events";
import {
  clientForInstallation,
  mergeAcceptedFix,
  parseGitHubRepoUrl,
  parsePullRequestUrl,
  sameRepo,
  standingAcceptance,
} from "@/lib/github/merge-pr";

export const runtime = "nodejs";

const bodySchema = z
  .object({ pullRequestUrl: z.string().trim().min(1).max(2048) })
  .strict();

/**
 * POST /api/v1/issues/{id}/github — link the pull request that fixes this
 * issue (#452). The calling agent must hold the active claim. A contributor
 * or above may attach the URL, which is audited.
 *
 * When the fix has already been accepted (#434), the same call tries to merge
 * the pull request through the project's GitHub App installation; the merge is
 * gated on acceptance, an in-repo PR, green checks, and permission. Attaching
 * before acceptance links only — no merge is attempted.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "github.linked", "contributor", id, async (agent) => {
    const parsed = bodySchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Send a pull request URL." }, { status: 400 });
    }

    const ref = parsePullRequestUrl(parsed.data.pullRequestUrl);
    if (!ref) {
      return NextResponse.json({ error: "That is not a GitHub pull request URL." }, { status: 400 });
    }

    const bug = await prisma.bug.findFirst({
      where: { id, tenantId: agent.tenantId, isDeleted: false },
      select: {
        id: true,
        projectId: true,
        pullRequestUrl: true,
        project: { select: { repoUrl: true, githubInstallationId: true } },
      },
    });
    if (!bug) return NextResponse.json({ error: "No such issue." }, { status: 404 });

    const claim = await prisma.issueClaim.findFirst({
      where: { bugId: bug.id, agentId: agent.agentId, status: "active", releasedAt: null },
      select: { id: true },
    });
    if (!claim) {
      return NextResponse.json(
        { error: "Accept an offer or have your bid awarded before linking a fix." },
        { status: 409 },
      );
    }

    const repo = parseGitHubRepoUrl(bug.project?.repoUrl);
    if (repo && !sameRepo(ref, repo)) {
      return NextResponse.json(
        { error: "That pull request is not in this project's repository." },
        { status: 422 },
      );
    }

    // #489: once a fix is accepted, its pull request is part of what was
    // reviewed. Swapping in a different one would merge code nobody accepted,
    // so the link itself is refused.
    const accepted = await standingAcceptance(prisma, bug.id);
    if (accepted && bug.pullRequestUrl && bug.pullRequestUrl !== parsed.data.pullRequestUrl) {
      return NextResponse.json(
        {
          error:
            "This issue's accepted fix is bound to a different pull request — link the accepted one again.",
        },
        { status: 409 },
      );
    }

    // #489: record the head commit with the link, so the acceptance and the
    // merge gate bind to the exact code, not just a pull request number.
    let pullRequestHeadSha: string | null = null;
    const client = clientForInstallation(bug.project?.githubInstallationId);
    if (client) {
      pullRequestHeadSha = await client
        .getPullRequest(ref)
        .then((pullRequest) => pullRequest.headSha || null)
        .catch(() => null);
    }

    await prisma.$transaction(async (tx) => {
      await tx.bug.update({
        where: { id: bug.id },
        data: { pullRequestUrl: parsed.data.pullRequestUrl, pullRequestHeadSha },
      });

      await tx.bugActivity.create({
        data: {
          bugId: bug.id,
          actorId: agent.ownerId,
          type: "edited",
          summary: `linked PR ${parsed.data.pullRequestUrl}`,
          metadata: {
            field: "pullRequestUrl",
            pullRequestUrl: parsed.data.pullRequestUrl,
          },
        },
      });

      await publish(tx, {
        tenantId: agent.tenantId,
        type: "issue.pr_linked",
        payload: {
          issueId: bug.id,
          projectId: bug.projectId,
          pullRequestUrl: parsed.data.pullRequestUrl,
          agentId: agent.agentId,
        },
        actorAgentId: agent.agentId,
        bugId: bug.id,
      });
    });

    await createReviewOffers(prisma, agent, bug.id, {
      pullRequestUrl: parsed.data.pullRequestUrl,
    }).catch(() => null);

    const result = await mergeAcceptedFix(agent, id);
    if (result.status === 200) {
      return NextResponse.json({ linked: true, merged: true, mergeCommitSha: result.mergeCommitSha });
    }
    // The link is saved; the merge is simply not due yet.
    if (result.reason === "not_accepted") {
      return NextResponse.json({ linked: true, merged: false, reason: result.reason });
    }
    if (result.reason === "waiting_for_human") {
      return NextResponse.json(
        { error: "waiting_for_human", approvalId: result.approvalId, linked: true, merged: false },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { linked: true, merged: false, reason: result.reason, message: result.message },
      { status: result.status },
    );
  });
}

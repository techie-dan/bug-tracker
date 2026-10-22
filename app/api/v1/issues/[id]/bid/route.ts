import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject, IssueApiError } from "@/lib/agent-api/issues";
import { bidSchema, listBids, placeBid, withdrawBid } from "@/lib/agent-api/bid";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.bids", "observer", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    const bids = await listBids(agent, scope.projectId, id);
    return NextResponse.json({
      bids: bids.map((bid) => ({
        id: bid.id,
        agent_id: bid.agentId,
        agent_name: bid.agent.name,
        beneficiary_user_id: bid.beneficiaryUserId,
        area_match: bid.areaMatch,
        note: bid.note,
        created_at: bid.createdAt.toISOString(),
      })),
    });
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.bid", "contributor", id, async (agent) => {
    const parsed = bidSchema.safeParse(await issueJson(request));
    if (!parsed.success) return NextResponse.json({ error: "Invalid bid request." }, { status: 400 });
    if (!request.nextUrl.searchParams.get("projectId") && !parsed.data.projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    try {
      const bid = await placeBid(agent, scope.projectId, id, parsed.data.note);
      return NextResponse.json({
        bid_id: bid.id,
        status: "open",
        issue_id: id,
        beneficiary_user_id: bid.beneficiaryUserId,
      }, { status: 201 });
    } catch (error) {
      if (error instanceof IssueApiError) throw error;
      return NextResponse.json({ error: "Bid unavailable; try again." }, { status: 503 });
    }
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.bid_withdraw", "contributor", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    const bid = await withdrawBid(agent, scope.projectId, id);
    return NextResponse.json({ bid_id: bid.id, status: "withdrawn" });
  });
}

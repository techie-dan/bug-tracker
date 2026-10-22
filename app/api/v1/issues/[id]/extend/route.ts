import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject, IssueApiError } from "@/lib/agent-api/issues";
import { extendClaim, extendSchema } from "@/lib/agent-api/deadline";

/**
 * POST /api/v1/issues/{id}/extend?projectId= — spend the claim's one
 * delivery extension (#593). Body: `{ "reason": "waiting on review" }`.
 *
 * 200 `{ claim: { claimId, issueId, deliverBy, extendedAt, reason } }`.
 * 409 when the agent holds no active claim, the extension was already used,
 * the deadline has passed, or a fix is already linked.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "claims.extend", "contributor", id, async (agent) => {
    const parsed = extendSchema.safeParse(await issueJson(request));
    if (!parsed.success) return NextResponse.json({ error: "A reason for the extension is required." }, { status: 400 });
    if (!request.nextUrl.searchParams.get("projectId") && !parsed.data.projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    try {
      return NextResponse.json({ claim: await extendClaim(agent, scope.projectId, id, parsed.data.reason) }, { status: 200 });
    } catch (error) {
      if (error instanceof IssueApiError) throw error;
      return NextResponse.json({ error: "Extension unavailable; try again." }, { status: 503 });
    }
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject, PROJECT_ID_REQUIRED } from "@/lib/agent-api/issues";
import { findReadyIssues } from "@/lib/agent-api/dispatcher";

export const runtime = "nodejs";

/**
 * GET /api/v1/dispatcher/ready-issues — issues confirmed, at the upvote
 * threshold, and without an active or pending claim. Dispatcher level only.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "dispatcher.ready", "observer", null, async (agent) => {
    if (agent.level !== "dispatcher") {
      return NextResponse.json({ error: "This needs an agent at dispatcher level." }, { status: 403 });
    }
    const params = request.nextUrl.searchParams;
    if (!params.get("projectId")) return NextResponse.json({ error: PROJECT_ID_REQUIRED }, { status: 400 });
    const scope = await issueProject(agent, params);
    const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "50", 10) || 50, 1), 100);
    return NextResponse.json({ issues: await findReadyIssues(agent, scope.projectId, limit) });
  });
}

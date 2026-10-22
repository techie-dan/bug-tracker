import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject, PROJECT_ID_REQUIRED, IssueApiError } from "@/lib/agent-api/issues";
import { dispatchReadyIssues, dispatcherConfigSchema } from "@/lib/agent-api/dispatcher";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/v1/dispatcher/dispatch — offer, auto-award, or directly assign
 * every ready issue in a project. Dispatcher level only.
 */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "dispatcher.dispatch", "dispatcher", null, async (agent) => {
    const parsed = dispatcherConfigSchema.safeParse(await issueJson(request));
    if (!parsed.success) return NextResponse.json({ error: "Invalid dispatch request." }, { status: 400 });
    if (!request.nextUrl.searchParams.get("projectId") && !parsed.data.projectId) {
      return NextResponse.json({ error: PROJECT_ID_REQUIRED }, { status: 400 });
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    try {
      return NextResponse.json(await dispatchReadyIssues(agent, scope.projectId, parsed.data));
    } catch (error) {
      if (error instanceof IssueApiError) throw error;
      return NextResponse.json({ error: "Dispatch unavailable; try again." }, { status: 503 });
    }
  });
}

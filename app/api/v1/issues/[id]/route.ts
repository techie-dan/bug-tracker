import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject, readAgentIssue } from "@/lib/agent-api/issues";

/** GET ?projectId= returns an issue, its latest 100 comments, its validations, and whether it is confirmed. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.read", "observer", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json({ issue: await readAgentIssue(scope, id) });
  });
}

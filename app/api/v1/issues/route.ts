import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, createAgentIssue, issueProject, listAgentIssues } from "@/lib/agent-api/issues";

/** GET ?projectId=&status=&severity=&platform=&area=&assignee=&stage=&cursor=&limit= */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "issues.list", "observer", null, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await listAgentIssues(scope, request.nextUrl.searchParams));
  });
}

/** POST JSON with title, description. The reporter/beneficiary is always the agent's owner (#494).
 * Supply projectId in query or body and Idempotency-Key in headers.
 * Optional categoryId, typeId, proofLinks (newline-separated GitHub URLs), acknowledgeSimilar.
 * Client severity is ignored; status and assignment cannot be set here.
 */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "issues.create", "contributor", null,
    (agent) => createAgentIssue(agent, request));
}

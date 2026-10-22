import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson } from "@/lib/agent-api/issues";
import { agentEscalationSchema, askAgentEscalation } from "@/lib/agent-questions";

export const runtime = "nodejs";

/**
 * POST /api/v1/escalations — submit a typed escalation to the owner (#749).
 * Body: `{ "body": "…", "type": "question" | "work_authorization" | "blocker" | "scope_change" | "human_approval", "bugId": "…" }`
 */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "escalations.create", "contributor", null, async (agent) => {
    const parsed = agentEscalationSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid escalation.", details: parsed.error.issues }, { status: 400 });
    }
    const escalation = await askAgentEscalation(agent, parsed.data);
    return NextResponse.json({ escalation }, { status: 201 });
  });
}

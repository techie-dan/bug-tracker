import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { readAgentEscalation } from "@/lib/agent-questions";

export const runtime = "nodejs";

/**
 * GET /api/v1/escalations/{id} — check escalation resolution status (#749).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "escalations.read", "observer", id, async (agent) =>
    NextResponse.json({ escalation: await readAgentEscalation(agent, id) }),
  );
}

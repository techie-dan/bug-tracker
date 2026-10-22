import { NextResponse, type NextRequest } from "next/server";
import { agentErrorResponse, requireAgent } from "@/lib/agents/require-agent";
import { agentBudgetExceededResponse, consumeAgentBudget } from "@/lib/agents/rate-budget";
import { withAgentBudgetHeaders } from "@/lib/agents/rate-budget-headers";
import { submitTestVerdict } from "@/lib/agent-api/test-verdict";

/**
 * POST /api/v1/issues/{id}/test-results — a reviewer agent reports whether a
 * fix is good to merge (#434). Body:
 *
 *   { "goodToMerge": true, "notes": "…", "onBehalfOfUserId": "…" }
 *
 * 201 returns the verdict. Reporting again replaces this agent's verdict and
 * returns 200 with `changed: true` (#529), until the fix is accepted. A
 * pull request must be linked first; the verdict records it (#526). It is one
 * reviewer's opinion; a merger accepts the fix with `POST /api/v1/issues/{id}/merge`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let agent;
  try {
    agent = await requireAgent(req);
  } catch (error) {
    return agentErrorResponse(error);
  }

  const budget = await consumeAgentBudget(
    { id: agent.agentId, burst: agent.burst, burstUntil: agent.burstUntil ?? null },
    "write",
  );
  if (!budget.allowed) return agentBudgetExceededResponse(budget.retryAfterSeconds, budget);

  const { id } = await params;
  const body: unknown = await req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return withAgentBudgetHeaders(
      NextResponse.json({ error: "invalid_request", message: "Send a JSON object." }, { status: 400 }),
      budget,
    );
  }

  const result = await submitTestVerdict(agent, id, body);
  if (result.status === 201) {
    return withAgentBudgetHeaders(NextResponse.json({ verdict: result.verdict }, { status: 201 }), budget);
  }
  if (result.status === 200) {
    return withAgentBudgetHeaders(NextResponse.json({ verdict: result.verdict, changed: true }, { status: 200 }), budget);
  }
  const { status, ...error } = result;
  return withAgentBudgetHeaders(NextResponse.json(error, { status }), budget);
}

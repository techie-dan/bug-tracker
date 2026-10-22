import { NextResponse, type NextRequest } from "next/server";
import { agentErrorResponse, requireAgent } from "@/lib/agents/require-agent";
import { agentBudgetExceededResponse, consumeAgentBudget } from "@/lib/agents/rate-budget";
import { withAgentBudgetHeaders } from "@/lib/agents/rate-budget-headers";
import { listAgentProjectSummaries } from "@/lib/agent-api/projects";
import { readAgentInstructions } from "@/lib/agent-messages";

/**
 * GET /api/v1/agents/me — who this key belongs to (#427). Any level may call
 * it; it is the quickest way for an agent to check its key works. It also
 * lists the tenant's projects (#607) so an agent can pick the `projectId`
 * every issue route needs, and the owner's standing `instructions` (#605).
 */
export async function GET(req: NextRequest) {
  try {
    const agent = await requireAgent(req);
    // A read like the other list/get routes, so every authenticated agent
    // response carries its own quota headers (#596).
    const budget = await consumeAgentBudget(
      { id: agent.agentId, burst: agent.burst, burstUntil: agent.burstUntil ?? null },
      "read",
    );
    if (!budget.allowed) return agentBudgetExceededResponse(budget.retryAfterSeconds, budget);
    const [projects, instructions] = await Promise.all([
      listAgentProjectSummaries(agent.tenantId),
      readAgentInstructions(agent.agentId),
    ]);
    return withAgentBudgetHeaders(
      NextResponse.json({
        id: agent.agentId,
        name: agent.name,
        owner_id: agent.ownerId,
        tenant_id: agent.tenantId,
        level: agent.level,
        project_id: agent.projectId ?? null,
        project_slug: agent.projectSlug ?? null,
        projects,
        instructions,
      }),
      budget,
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
}

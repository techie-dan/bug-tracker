import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { readGoal, updateGoalStatus } from "@/lib/goals/service";
import { updateGoalStatusSchema } from "@/lib/validations/goal";

export const runtime = "nodejs";

/** GET ?projectId= — one goal with its budget summary and live allocations (#616). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "goals.read", "observer", id, async (agent) => {
    await issueProject(agent, request.nextUrl.searchParams);
    const { goal, allocations } = await readGoal(agent, id);
    return NextResponse.json({ goal, budget: goal.budget, allocations });
  });
}

/** PATCH JSON `{ "status": "active" | "completed" | "cancelled" }` (#616). */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "goals.update", "contributor", id, async (agent) => {
    const parsed = updateGoalStatusSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid goal status.", details: parsed.error.issues }, { status: 400 });
    }
    await issueProject(agent, request.nextUrl.searchParams);
    const goal = await updateGoalStatus(agent, id, parsed.data);
    return NextResponse.json({ goal, budget: goal.budget });
  });
}

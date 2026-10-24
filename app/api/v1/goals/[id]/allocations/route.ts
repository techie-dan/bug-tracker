import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { readGoal, splitGoalPool } from "@/lib/goals/service";
import { splitGoalPoolSchema } from "@/lib/validations/goal";

export const runtime = "nodejs";

/** GET ?projectId= — every live allocation slice carved from the goal's pool (#616). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "goals.allocations.list", "observer", id, async (agent) => {
    await issueProject(agent, request.nextUrl.searchParams);
    const { allocations } = await readGoal(agent, id);
    return NextResponse.json({ allocations });
  });
}

/**
 * POST JSON `{ method, amount?, sourceKey?, targets }` — executes a pool split
 * across issues, nested goals, or agent deliverables (#616). Refusals arrive
 * as 400 (bad weights/shares/targets) or 409 (over-allocation, duplicate
 * `sourceKey`, closed goal).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "goals.split", "contributor", id, async (agent) => {
    const parsed = splitGoalPoolSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid split request.", details: parsed.error.issues }, { status: 400 });
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    const { goal, allocations } = await splitGoalPool(agent, id, { ...parsed.data, projectId: scope.projectId });
    return NextResponse.json({ goal, budget: goal.budget, allocations }, { status: 201 });
  });
}

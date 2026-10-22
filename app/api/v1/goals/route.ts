import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { createGoal, listGoals } from "@/lib/goals/service";
import { createGoalSchema } from "@/lib/validations/goal";

export const runtime = "nodejs";

/** GET ?projectId= — the project's goals with budget summaries, newest first (#616). */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "goals.list", "observer", null, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json({ goals: await listGoals(scope.tenantId, scope.projectId) });
  });
}

/** POST JSON with title, budgetPool, optional description — creates a goal (#616). */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "goals.create", "contributor", null, async (agent) => {
    const parsed = createGoalSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid goal request.", details: parsed.error.issues }, { status: 400 });
    }
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    try {
      const goal = await createGoal(agent, { ...parsed.data, projectId: scope.projectId });
      return NextResponse.json({ goal }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && "status" in error) throw error;
      return NextResponse.json({ error: "Could not create this goal; try again." }, { status: 503 });
    }
  });
}

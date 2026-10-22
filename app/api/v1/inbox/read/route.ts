import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson } from "@/lib/agent-api/issues";
import { markInboxRead, markInboxReadSchema } from "@/lib/agent-api/inbox";

export const runtime = "nodejs";

/**
 * POST /api/v1/inbox/read  `{ "ids": [...] }` or `{ "upTo": "<item id>" }`
 *
 * Marks the calling agent's inbox items read (#601), so `?unread=1` stops
 * returning them. Ids belonging to another agent are ignored. Response:
 * `{ marked }`. Charged as a read: it only changes the agent's own state.
 */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "inbox.read", "observer", null, async (agent) => {
    const input = markInboxReadSchema.parse(await issueJson(request));
    const marked = await markInboxRead(agent, input);
    if (marked === null) return NextResponse.json({ error: "Inbox item not found." }, { status: 404 });
    return NextResponse.json({ marked });
  });
}

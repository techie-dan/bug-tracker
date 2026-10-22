import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveSessionUserId } from "@/lib/session-user";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { IssueApiError, issueJson } from "@/lib/agent-api/issues";
import { decideApproval } from "@/lib/approvals";

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
}).strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const headers = { "Cache-Control": "private, no-store" };

  if (request.headers.has("authorization")) {
    return NextResponse.json({ error: "A person must approve or reject this request." }, { status: 403, headers });
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403, headers });
  }

  const session = await resolveSessionUserId();
  if ("error" in session) {
    return NextResponse.json({ error: "Sign in to decide an approval." }, { status: 401, headers });
  }

  const tenantId = await currentTenantIdFor(session.userId);
  if (!tenantId) {
    return NextResponse.json({ error: "Workspace membership required." }, { status: 403, headers });
  }

  try {
    const parsed = decisionSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose approved or rejected." }, { status: 400, headers });
    }

    const { id } = await context.params;
    const approval = await decideApproval(session.userId, tenantId, id, parsed.data.decision);
    return NextResponse.json({ ok: true, approval }, { headers });
  } catch (error) {
    if (error instanceof IssueApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    return NextResponse.json({ error: "Approval decision unavailable." }, { status: 503, headers });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { pointBalance } from "@/lib/points/balance";

const isoDateString = z.string().refine((val) => {
  // Strict ISO-8601: date-only `YYYY-MM-DD` or a full datetime. This rejects
  // values like `1` that `new Date()` happens to parse (1 January 2001).
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  if (!dateOnly.test(val) && !dateTime.test(val)) return false;
  return !Number.isNaN(new Date(val).getTime());
}, "must be an ISO-8601 date or datetime");

const balanceQuerySchema = z
  .object({
    from: isoDateString.optional(),
    to: isoDateString.optional(),
  })
  .refine((query) => !query.from || !query.to || new Date(query.from).getTime() <= new Date(query.to).getTime(), {
    message: "`from` must not be after `to`.",
  });

/**
 * GET /api/v1/agents/me/points?from=&to= — the balance of the person this key
 * works for (#618), summed from the append-only PointEntry ledger inside the
 * agent's tenant. The owner's, never a stranger's: the person comes from the
 * agent row, as on every other route here.
 *
 * `from`/`to` are optional inclusive ISO-8601 bounds on when the entry was
 * written; with neither, the period covers everything and matches `lifetime`.
 * The wallet address is deliberately not in this response: it is readable only
 * by the person and tenant admins, and an agent is neither.
 *
 * Rate: charged as a read. Audited as `points.balance`.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "points.balance", "observer", null, async (agent) => {
    const parsed = balanceQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "from and to must be ISO-8601 dates, and from must not be after to." },
        { status: 400 },
      );
    }

    const balance = await pointBalance(prisma, {
      tenantId: agent.tenantId,
      userId: agent.ownerId,
      from: parsed.data.from,
      to: parsed.data.to,
    });

    return NextResponse.json({
      user_id: agent.ownerId,
      tenant_id: agent.tenantId,
      lifetime: balance.lifetime,
      period: balance.period,
    });
  });
}

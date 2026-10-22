import { timingSafeEqual, createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runPlatformSweeps } from "@/lib/cron/runner";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { agentPlatformDisabledResponse } from "@/lib/agents/platform-gate";

export const runtime = "nodejs";
export const maxDuration = 60;

function bearerMatches(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(authorization ?? ""), hash(`Bearer ${secret}`));
}

async function handleCronRequest(request: NextRequest) {
  if (!isAgentPlatformEnabled()) return agentPlatformDisabledResponse();
  const secret = process.env.CRON_SECRET;
  const headers = { "Cache-Control": "no-store" };

  if (!secret) {
    return NextResponse.json({ error: "Cron runner is not configured." }, { status: 503, headers });
  }

  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }

  try {
    const result = await runPlatformSweeps();
    return NextResponse.json(result, { headers });
  } catch (err) {
    return NextResponse.json(
      { error: "Platform sweeps failed.", details: err instanceof Error ? err.message : String(err) },
      { status: 500, headers },
    );
  }
}

/**
 * Vercel Cron calls with GET and `Authorization: Bearer $CRON_SECRET` (#583, #647).
 */
export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}

/**
 * External schedulers (Coolify cron, curl, systemd) call with POST and
 * `Authorization: Bearer $CRON_SECRET` (#647).
 */
export async function POST(request: NextRequest) {
  return handleCronRequest(request);
}

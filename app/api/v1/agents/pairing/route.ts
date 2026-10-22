import { NextResponse, type NextRequest } from "next/server";
import { clientRateLimitKey, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { absoluteUrl } from "@/lib/site-url";
import { consumePairingLimit } from "@/lib/agents/rate-limit";
import { PAIRING_POLL_INTERVAL, pairingApprovalPath, startPairing } from "@/lib/agents/pairing";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { agentPlatformDisabledResponse } from "@/lib/agents/platform-gate";

/**
 * POST /api/v1/agents/pairing — an agent without a key asks to join (#427).
 * Body: `{ "name": "Ada's Claude", "model": "Claude", "level": "contributor" }`.
 * `level` may be any of observer, contributor, triager, reviewer, dispatcher;
 * omitting it gives contributor, and merger is refused (#425, #451). Show
 * `verification_uri_complete` in the owner's browser. After they approve,
 * poll `/api/v1/agents/pairing/token` with `device_code` every `interval` seconds.
 */
export async function POST(req: NextRequest) {
  const retryAfter = await consumePairingLimit("start", clientRateLimitKey(req));
  if (retryAfter) {
    return NextResponse.json(
      { error: "rate_limited", message: RATE_LIMIT_MESSAGE },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  // #505: switched off means switched off, not just hidden in Settings.
  if (!isAgentPlatformEnabled()) return agentPlatformDisabledResponse();
  const body = (await req.json().catch(() => null)) as { name?: unknown; model?: unknown; level?: unknown } | null;
  const result = await startPairing({ name: body?.name, model: body?.model, level: body?.level });
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_request", message: result.error }, { status: 400 });
  }

  return NextResponse.json(
    {
      user_code: result.userCode,
      device_code: result.deviceCode,
      verification_uri: absoluteUrl("/settings/agents/pair"),
      verification_uri_complete: absoluteUrl(pairingApprovalPath(result.userCode)),
      expires_at: result.expiresAt.toISOString(),
      interval: PAIRING_POLL_INTERVAL,
      message:
        "Open verification_uri_complete in the owner's browser yourself. Do not only print it. They approve it while signed in. Then poll the token URL with device_code until api_key is returned.",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

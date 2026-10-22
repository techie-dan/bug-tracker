import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveAuthSecret } from "@/lib/auth-secret";

/**
 * Keeps the session that signed every other one out (Ziki #389). Bumping
 * User.sessionVersion invalidates every JWT, including the caller's. The
 * server then asks Auth.js to update the caller's token with this signed
 * refresh, and the jwt callback moves it to the new version.
 *
 * The browser can also send session updates (POST /api/auth/session), so the
 * refresh is signed with the auth secret: a stale token can't move itself
 * forward by guessing the next number.
 */
export type SessionRefresh = { userId: string; from: number; to: number; expires: number; proof: string };

const LIFETIME_MS = 60_000;

function sign(userId: string, from: number, to: number, expires: number): string {
  return createHmac("sha256", resolveAuthSecret())
    .update(`session-refresh:${userId}:${from}:${to}:${expires}`)
    .digest("hex");
}

/** A refresh for the session that was at `to - 1` just before this change. */
export function sessionRefreshFor(userId: string, to: number, nowMs = Date.now()): SessionRefresh {
  const from = to - 1;
  const expires = nowMs + LIFETIME_MS;
  return { userId, from, to, expires, proof: sign(userId, from, to, expires) };
}

/**
 * The new session version when `data` carries a valid refresh for this token,
 * else null. The token must belong to the user and still be at `from`.
 */
export function acceptedSessionRefresh(
  token: { id?: unknown; sub?: unknown; sv?: unknown },
  data: unknown,
  nowMs = Date.now(),
): number | null {
  const refresh = (data as { sessionRefresh?: Partial<SessionRefresh> } | null | undefined)?.sessionRefresh;
  if (!refresh) return null;
  const { userId, from, to, expires, proof } = refresh;
  if (typeof userId !== "string" || typeof proof !== "string") return null;
  if (typeof from !== "number" || typeof to !== "number" || typeof expires !== "number") return null;
  if (!Number.isInteger(from) || to !== from + 1 || expires < nowMs) return null;
  if ((token.id ?? token.sub) !== userId) return null;
  if ((typeof token.sv === "number" ? token.sv : 0) !== from) return null;

  const expected = Buffer.from(sign(userId, from, to, expires), "hex");
  const given = Buffer.from(proof, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return to;
}

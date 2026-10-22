import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 seconds),
 * the format every authenticator app reads (#648). No dependency: this is
 * HMAC plus base32, and the RFC's own test vectors pin it in totp.test.ts.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Codes from one step either side are accepted, to absorb clock drift. */
export const TOTP_WINDOW_STEPS = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("Not a base32 string.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32 encoded (what authenticator apps expect). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The step number for a moment in time. */
export function totpStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for one step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** What people type: digits only, spaces and dashes ignored. */
export function normalizeTotpInput(input: string): string {
  return input.replace(/[\s-]/g, "");
}

export function looksLikeTotpCode(input: string): boolean {
  return /^\d{6}$/.test(normalizeTotpInput(input));
}

/**
 * The step a code matches within the drift window, or null. A code is only
 * good for a step later than `afterStep`, so one code cannot be used twice
 * (including by someone who watched it being typed).
 */
export function matchTotp(
  secret: string,
  input: string,
  { nowMs = Date.now(), afterStep = null }: { nowMs?: number; afterStep?: number | null } = {},
): number | null {
  const code = normalizeTotpInput(input);
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(nowMs);
  let matched: number | null = null;
  // Check every step so the time taken does not reveal which one matched.
  for (let step = current - TOTP_WINDOW_STEPS; step <= current + TOTP_WINDOW_STEPS; step++) {
    const expected = Buffer.from(totpCode(secret, step));
    const given = Buffer.from(code);
    if (timingSafeEqual(expected, given) && (afterStep === null || step > afterStep)) {
      matched = step;
    }
  }
  return matched;
}

/** The otpauth:// link authenticator apps import; QR codes carry this. */
export function otpauthUri(account: string, secret: string, issuer = "Ziki Issues"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

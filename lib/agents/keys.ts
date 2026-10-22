import { createHash, randomBytes, randomInt } from "node:crypto";

/**
 * Agent API keys and pairing codes (#427). A SHA-256 hash is always stored.
 * The raw key is also sealed, so the owner can copy each agent's key again
 * from Settings. It is never stored in the clear.
 */

/** Every key starts with this, so a leaked one is easy to recognise. */
export const API_KEY_PREFIX = "ziki_";
/** How much of the key is kept for display, e.g. "ziki_Ab3dE6". */
export const KEY_DISPLAY_LENGTH = API_KEY_PREFIX.length + 6;

export function hashSecret(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export type NewApiKey = { raw: string; hash: string; prefix: string };

/** A fresh key: 32 random bytes, so it can't be guessed. */
export function generateApiKey(): NewApiKey {
  const raw = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { raw, hash: hashSecret(raw), prefix: raw.slice(0, KEY_DISPLAY_LENGTH) };
}

/** Reads `Authorization: Bearer <key>`. Anything else is no key. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  const token = match?.[1];
  return token && token.startsWith(API_KEY_PREFIX) ? token : null;
}

// No 0/O, 1/I/L or U: the code is read off one screen and typed into another.
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const USER_CODE_LENGTH = 8;

/** The short code the owner types to approve a pairing, e.g. "KX7P-2MQD". */
export function generateUserCode(): string {
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * The form a typed code is hashed in: upper case, no spaces or dashes. Null
 * when it can't be a code at all, so a typo never reaches the database.
 */
export function normalizeUserCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== USER_CODE_LENGTH) return null;
  for (const char of code) if (!USER_CODE_ALPHABET.includes(char)) return null;
  return code;
}

/** The secret the waiting agent polls with to collect its key. */
export function generateDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

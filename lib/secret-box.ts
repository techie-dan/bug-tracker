import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cleanEnv } from "@/lib/env-clean";

/**
 * AES-256-GCM sealed with a key derived from NEXTAUTH_SECRET.
 * AUTH_SECRET is accepted when that name is the one set locally.
 * Used so a shareable invite link can be shown again to the people who
 * manage it, without storing the raw token in the clear.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(): Buffer {
  const secret = cleanEnv(process.env.NEXTAUTH_SECRET) || cleanEnv(process.env.AUTH_SECRET);
  if (!secret || secret.length < 16) {
    throw new Error("NEXTAUTH_SECRET must be set before invite links can be stored.");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Hex is iv (12 bytes) + auth tag (16 bytes) + ciphertext. */
export function sealSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + tag.toString("hex") + ciphertext.toString("hex");
}

export function openSecret(sealed: string): string {
  const ivHex = sealed.slice(0, IV_BYTES * 2);
  const tagHex = sealed.slice(IV_BYTES * 2, IV_BYTES * 2 + TAG_BYTES * 2);
  const ciphertextHex = sealed.slice(IV_BYTES * 2 + TAG_BYTES * 2);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
  return plain.toString("utf8");
}

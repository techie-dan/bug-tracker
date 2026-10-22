import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  looksLikeTotpCode,
  matchTotp,
  normalizeTotpInput,
  otpauthUri,
  totpCode,
  totpStep,
} from "./totp";

// RFC 6238 appendix B: the SHA-1 secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("base32 (RFC 4648)", () => {
  it("matches the RFC test vectors", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Encode(Buffer.from("fooba"))).toBe("MZXW6YTB");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
  });

  it("decodes lowercase, spaces and padding, as people paste them", () => {
    expect(base32Decode("mzxw 6ytb oi======").toString()).toBe("foobar");
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("MZXW1")).toThrow();
  });
});

describe("totpCode (RFC 6238 test vectors, last six digits)", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("at %i seconds the code is %s", (seconds, expected) => {
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(expected);
  });
});

describe("matchTotp", () => {
  const now = 1_700_000_000_000;
  const step = totpStep(now);

  it("accepts the current code and one step of drift either way", () => {
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step), { nowMs: now })).toBe(step);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), { nowMs: now })).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), { nowMs: now })).toBe(step + 1);
  });

  it("rejects codes outside the window and malformed input", () => {
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), { nowMs: now })).toBeNull();
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), { nowMs: now })).toBeNull();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34"]) {
      expect(matchTotp(RFC_SECRET, bad, { nowMs: now })).toBeNull();
    }
  });

  it("ignores spaces and dashes in what was typed", () => {
    const code = totpCode(RFC_SECRET, step);
    expect(matchTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now })).toBe(step);
    expect(matchTotp(RFC_SECRET, `${code.slice(0, 3)}-${code.slice(3)}`, { nowMs: now })).toBe(step);
  });

  it("refuses a step that was already used, so a code works once", () => {
    const code = totpCode(RFC_SECRET, step);
    expect(matchTotp(RFC_SECRET, code, { nowMs: now, afterStep: step - 1 })).toBe(step);
    expect(matchTotp(RFC_SECRET, code, { nowMs: now, afterStep: step })).toBeNull();
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), { nowMs: now, afterStep: step })).toBeNull();
  });

  it("does not accept a code made from a different secret", () => {
    const other = generateTotpSecret();
    expect(matchTotp(RFC_SECRET, totpCode(other, step), { nowMs: now })).toBeNull();
  });
});

describe("secrets and links", () => {
  it("makes distinct 160-bit base32 secrets", () => {
    const a = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(a);
  });

  it("builds an otpauth link an authenticator app can import", () => {
    const uri = otpauthUri("ada@example.com", "ABCDEFGH");
    expect(uri.startsWith("otpauth://totp/Ziki%20Issues:ada%40example.com?")).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get("secret")).toBe("ABCDEFGH");
    expect(params.get("issuer")).toBe("Ziki Issues");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
  });

  it("recognises what a six-digit code looks like", () => {
    expect(looksLikeTotpCode("123 456")).toBe(true);
    expect(looksLikeTotpCode("ABCDE-FGHJK")).toBe(false);
    expect(normalizeTotpInput(" 123-456 ")).toBe("123456");
  });
});

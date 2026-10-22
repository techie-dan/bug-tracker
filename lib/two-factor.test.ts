import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const tx = {
    totpCredential: { update: vi.fn(), deleteMany: vi.fn() },
    totpBackupCode: { deleteMany: vi.fn(), createMany: vi.fn() },
    securityAuditEvent: { create: vi.fn() },
    user: { update: vi.fn() },
  };
  return {
    ...tx,
    totpCredential: { ...tx.totpCredential, findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    totpBackupCode: { ...tx.totpBackupCode, count: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    tx,
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const limits = vi.hoisted(() => ({ attempt: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: limits.attempt, consumeAuthRateLimit: limits.auth }));

import { openSecret, sealSecret } from "@/lib/secret-box";
import { totpCode, totpStep } from "@/lib/totp";
import {
  BACKUP_CODE_COUNT,
  confirmEnrolment,
  confirmIdentity,
  disableTwoFactor,
  generateBackupCode,
  hashBackupCode,
  regenerateBackupCodes,
  startEnrolment,
  twoFactorStatus,
  verifySecondFactor,
} from "./two-factor";

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const NOW = 1_800_000_000_000;
const STEP = totpStep(NOW);
const goodCode = () => totpCode(SECRET, STEP);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-for-hashing";
  limits.attempt.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  limits.auth.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  db.tx.user.update.mockResolvedValue({ sessionVersion: 4 });
});

const SIGN_OUT_EVERY_SESSION = {
  where: { id: "u1" },
  data: { sessionVersion: { increment: 1 } },
  select: { sessionVersion: true },
};

describe("backup codes", () => {
  it("are XXXXX-XXXXX from an alphabet without look-alikes, and differ", () => {
    const a = generateBackupCode();
    expect(a).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(generateBackupCode()).not.toBe(a);
  });

  it("hash the same however they are typed, per user, and never contain the code", () => {
    const hashed = hashBackupCode("u1", "abcde-fghjk");
    expect(hashed).toBe(hashBackupCode("u1", "ABCDE FGHJK"));
    expect(hashed).not.toBe(hashBackupCode("u2", "ABCDE-FGHJK"));
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain("ABCDE");
  });
});

describe("startEnrolment", () => {
  it("stores the secret sealed, not in the clear, and returns it once with an otpauth link", async () => {
    db.totpCredential.findUnique.mockResolvedValue(null);
    const result = await startEnrolment("u1", "ada@example.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = db.totpCredential.upsert.mock.calls[0][0].create.secret as string;
    expect(stored).not.toContain(result.secret);
    expect(openSecret(stored)).toBe(result.secret);
    expect(result.uri).toContain(`secret=${result.secret}`);
    expect(db.totpCredential.upsert.mock.calls[0][0].update).toMatchObject({ enabledAt: null, lastUsedStep: null });
  });

  it("refuses when two-factor is already on", async () => {
    db.totpCredential.findUnique.mockResolvedValue({ enabledAt: new Date() });
    expect((await startEnrolment("u1", "a@b.co")).ok).toBe(false);
    expect(db.totpCredential.upsert).not.toHaveBeenCalled();
  });
});

describe("confirmEnrolment", () => {
  beforeEach(() => db.totpCredential.findUnique.mockResolvedValue({ userId: "u1", secret: sealSecret(SECRET), enabledAt: null }));

  it("turns two-factor on with a right code and returns 10 single-view backup codes, stored hashed", async () => {
    const result = await confirmEnrolment("u1", goodCode(), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(db.tx.totpCredential.update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { enabledAt: new Date(NOW), lastUsedStep: STEP },
    });
    const stored = db.tx.totpBackupCode.createMany.mock.calls[0][0].data as { codeHash: string }[];
    expect(stored.map((row) => row.codeHash)).toEqual(result.codes.map((code) => hashBackupCode("u1", code)));
    expect(JSON.stringify(stored)).not.toContain(result.codes[0]);
    expect(db.tx.securityAuditEvent.create).toHaveBeenCalledWith({ data: { userId: "u1", type: "totp.enabled" } });
  });

  it("signs out every other session in the same transaction and returns the new version (Ziki #389)", async () => {
    const result = await confirmEnrolment("u1", goodCode(), NOW);
    expect(db.tx.user.update).toHaveBeenCalledWith(SIGN_OUT_EVERY_SESSION);
    expect(result).toMatchObject({ ok: true, sessionVersion: 4 });
  });

  it("changes nothing on a wrong code", async () => {
    const result = await confirmEnrolment("u1", "000000", NOW);
    expect(result.ok).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.tx.user.update).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    limits.attempt.mockResolvedValue({ allowed: false, retryAfterMs: 1000 });
    expect((await confirmEnrolment("u1", goodCode(), NOW)).ok).toBe(false);
    expect(db.totpCredential.findUnique).not.toHaveBeenCalled();
  });

  it("will not confirm one that is already on", async () => {
    db.totpCredential.findUnique.mockResolvedValue({ userId: "u1", secret: sealSecret(SECRET), enabledAt: new Date() });
    expect((await confirmEnrolment("u1", goodCode(), NOW)).ok).toBe(false);
  });
});

describe("verifySecondFactor", () => {
  const enabled = (lastUsedStep: number | null = null) =>
    db.totpCredential.findUnique.mockResolvedValue({ userId: "u1", secret: sealSecret(SECRET), enabledAt: new Date(), lastUsedStep });

  it("accepts a right authenticator code and moves the used step forward atomically", async () => {
    enabled();
    db.totpCredential.updateMany.mockResolvedValue({ count: 1 });
    expect(await verifySecondFactor("u1", goodCode(), NOW)).toBe("totp");
    expect(db.totpCredential.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: STEP } }] },
      data: { lastUsedStep: STEP },
    });
  });

  it("rejects a code whose step was already used", async () => {
    enabled(STEP);
    expect(await verifySecondFactor("u1", goodCode(), NOW)).toBeNull();
    expect(db.totpCredential.updateMany).not.toHaveBeenCalled();
  });

  it("rejects the same code from a second request that lost the race", async () => {
    enabled();
    db.totpCredential.updateMany.mockResolvedValue({ count: 0 });
    expect(await verifySecondFactor("u1", goodCode(), NOW)).toBeNull();
  });

  it("rejects a wrong code", async () => {
    enabled();
    expect(await verifySecondFactor("u1", "123456", NOW)).toBeNull();
  });

  it("spends a backup code once and audits it", async () => {
    enabled();
    db.totpBackupCode.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await verifySecondFactor("u1", "abcde-fghjk", NOW)).toBe("backup");
    expect(db.totpBackupCode.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", codeHash: hashBackupCode("u1", "ABCDEFGHJK"), usedAt: null },
      data: { usedAt: new Date(NOW) },
    });
    expect(db.securityAuditEvent.create).toHaveBeenCalledWith({ data: { userId: "u1", type: "totp.backup_code_used" } });
    expect(await verifySecondFactor("u1", "ABCDE-FGHJK", NOW)).toBeNull();
  });

  it("ignores input that is neither a code nor a backup code, without touching the database", async () => {
    enabled();
    expect(await verifySecondFactor("u1", "hello", NOW)).toBeNull();
    expect(db.totpBackupCode.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing for someone without two-factor", async () => {
    db.totpCredential.findUnique.mockResolvedValue(null);
    expect(await verifySecondFactor("u1", goodCode(), NOW)).toBeNull();
  });

  it("is rate limited, so a six-digit code cannot be guessed", async () => {
    limits.attempt.mockResolvedValue({ allowed: false, retryAfterMs: 1000 });
    enabled();
    expect(await verifySecondFactor("u1", goodCode(), NOW)).toBeNull();
    expect(db.totpCredential.findUnique).not.toHaveBeenCalled();
    expect(limits.attempt.mock.calls[0][0]).toBe("2fa:u1");
  });
});

describe("confirmIdentity (fresh re-authentication)", () => {
  it("needs the right password", async () => {
    db.user.findUnique.mockResolvedValue({ email: "a@b.co", passwordHash: await hash("correct horse", 4) });
    db.totpCredential.findUnique.mockResolvedValue(null);
    expect((await confirmIdentity("u1", { password: "wrong" })).ok).toBe(false);
    expect((await confirmIdentity("u1", { password: "correct horse" })).ok).toBe(true);
  });

  it("also needs a current code when two-factor is on", async () => {
    db.user.findUnique.mockResolvedValue({ email: "a@b.co", passwordHash: await hash("pw-12345", 4) });
    db.totpCredential.findUnique.mockResolvedValue({ userId: "u1", secret: sealSecret(SECRET), enabledAt: new Date(), lastUsedStep: null });
    db.totpCredential.updateMany.mockResolvedValue({ count: 1 });
    expect(await confirmIdentity("u1", { password: "pw-12345" })).toMatchObject({ ok: false });
    expect(await confirmIdentity("u1", { password: "pw-12345", code: "000000" })).toMatchObject({ ok: false });
  });

  it("fails for an account with no password and when the sign-in limit is hit", async () => {
    db.user.findUnique.mockResolvedValue({ email: "a@b.co", passwordHash: null });
    expect((await confirmIdentity("u1", { password: "x" })).ok).toBe(false);
    db.user.findUnique.mockResolvedValue({ email: "a@b.co", passwordHash: await hash("pw-12345", 4) });
    limits.auth.mockResolvedValue({ allowed: false, retryAfterMs: 1000 });
    expect((await confirmIdentity("u1", { password: "pw-12345" })).ok).toBe(false);
  });
});

describe("disable, regenerate and status", () => {
  it("disabling removes the secret and every backup code, and is audited", async () => {
    await disableTwoFactor("u1");
    expect(db.tx.totpBackupCode.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(db.tx.totpCredential.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(db.tx.securityAuditEvent.create).toHaveBeenCalledWith({ data: { userId: "u1", type: "totp.disabled" } });
  });

  it("disabling signs out every other session in the same transaction (Ziki #389)", async () => {
    expect(await disableTwoFactor("u1")).toBe(4);
    expect(db.tx.user.update).toHaveBeenCalledWith(SIGN_OUT_EVERY_SESSION);
  });

  it("regenerating replaces all backup codes, audits it, and refuses when off", async () => {
    db.totpCredential.findUnique.mockResolvedValueOnce(null);
    expect((await regenerateBackupCodes("u1")).ok).toBe(false);
    expect(db.tx.user.update).not.toHaveBeenCalled();
    db.totpCredential.findUnique.mockResolvedValueOnce({ enabledAt: new Date() });
    const result = await regenerateBackupCodes("u1");
    expect(result.ok && result.codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(db.tx.totpBackupCode.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(db.tx.securityAuditEvent.create).toHaveBeenCalledWith({ data: { userId: "u1", type: "totp.backup_codes_regenerated" } });
  });

  it("regenerating signs out every other session in the same transaction (Ziki #389)", async () => {
    db.totpCredential.findUnique.mockResolvedValueOnce({ enabledAt: new Date() });
    expect(await regenerateBackupCodes("u1")).toMatchObject({ ok: true, sessionVersion: 4 });
    expect(db.tx.user.update).toHaveBeenCalledWith(SIGN_OUT_EVERY_SESSION);
  });

  it("reports status, counting only unused backup codes", async () => {
    db.totpCredential.findUnique.mockResolvedValue({ enabledAt: new Date() });
    db.totpBackupCode.count.mockResolvedValue(7);
    expect(await twoFactorStatus("u1")).toEqual({ enabled: true, backupCodesLeft: 7 });
    expect(db.totpBackupCode.count).toHaveBeenCalledWith({ where: { userId: "u1", usedAt: null } });
    db.totpCredential.findUnique.mockResolvedValue({ enabledAt: null });
    expect(await twoFactorStatus("u1")).toEqual({ enabled: false, backupCodesLeft: 0 });
  });
});

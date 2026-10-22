import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  confirmIdentity: vi.fn(),
  startEnrolment: vi.fn(),
  confirmEnrolment: vi.fn(),
  disableTwoFactor: vi.fn(),
  regenerateBackupCodes: vi.fn(),
  findUser: vi.fn(),
  revalidatePath: vi.fn(),
  updateSession: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/auth", () => ({ updateSession: mocks.updateSession }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.logError } }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser } } }));
vi.mock("@/lib/two-factor", () => ({
  confirmIdentity: mocks.confirmIdentity,
  startEnrolment: mocks.startEnrolment,
  confirmEnrolment: mocks.confirmEnrolment,
  disableTwoFactor: mocks.disableTwoFactor,
  regenerateBackupCodes: mocks.regenerateBackupCodes,
}));

import { acceptedSessionRefresh } from "@/lib/session-refresh";
import {
  confirmTwoFactorAction,
  disableTwoFactorAction,
  regenerateBackupCodesAction,
  startTwoFactorAction,
} from "./actions";

/** The version the current session's token is moved to by the last updateSession call. */
function refreshedTo(fromVersion: number) {
  const data = mocks.updateSession.mock.lastCall?.[0];
  return acceptedSessionRefresh({ id: "u1", sv: fromVersion }, data);
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "u1", email: "ada@example.com" });
  mocks.confirmIdentity.mockResolvedValue({ ok: true });
  mocks.findUser.mockResolvedValue({ email: "ada@example.com" });
  mocks.disableTwoFactor.mockResolvedValue(1);
});

describe("startTwoFactorAction", () => {
  it("re-authenticates with the password before making a secret", async () => {
    mocks.confirmIdentity.mockResolvedValue({ ok: false, error: "That password isn't right." });
    expect(await startTwoFactorAction(form({ password: "nope" }))).toEqual({ ok: false, error: "That password isn't right." });
    expect(mocks.confirmIdentity).toHaveBeenCalledWith("u1", { password: "nope" });
    expect(mocks.startEnrolment).not.toHaveBeenCalled();
  });

  it("returns the key and a QR image for the otpauth link", async () => {
    mocks.startEnrolment.mockResolvedValue({
      ok: true,
      secret: "JBSWY3DPEHPK3PXP",
      uri: "otpauth://totp/Ziki%20Issues:ada%40example.com?secret=JBSWY3DPEHPK3PXP",
    });
    const result = await startTwoFactorAction(form({ password: "pw" }));
    expect(mocks.startEnrolment).toHaveBeenCalledWith("u1", "ada@example.com");
    expect(result).toMatchObject({ ok: true, secret: "JBSWY3DPEHPK3PXP" });
    expect(result.ok && result.qr).toMatch(/^data:image\/png;base64,/);
  });

  it("passes on a refusal, such as two-factor already being on", async () => {
    mocks.startEnrolment.mockResolvedValue({ ok: false, error: "Already on." });
    expect(await startTwoFactorAction(form({ password: "pw" }))).toEqual({ ok: false, error: "Already on." });
  });
});

describe("confirmTwoFactorAction", () => {
  it("returns the backup codes and refreshes the page on success", async () => {
    mocks.confirmEnrolment.mockResolvedValue({ ok: true, codes: ["AAAAA-BBBBB"], sessionVersion: 3 });
    expect(await confirmTwoFactorAction(form({ code: "123456" }))).toEqual({ ok: true, codes: ["AAAAA-BBBBB"] });
    expect(mocks.confirmEnrolment).toHaveBeenCalledWith("u1", "123456");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/security");
  });

  it("keeps this session signed in at the new version (Ziki #389)", async () => {
    mocks.confirmEnrolment.mockResolvedValue({ ok: true, codes: ["AAAAA-BBBBB"], sessionVersion: 3 });
    await confirmTwoFactorAction(form({ code: "123456" }));
    expect(refreshedTo(2)).toBe(3);
  });

  it("does not refresh on a wrong code", async () => {
    mocks.confirmEnrolment.mockResolvedValue({ ok: false, error: "That code isn't right." });
    expect((await confirmTwoFactorAction(form({ code: "000000" }))).ok).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.updateSession).not.toHaveBeenCalled();
  });

  it("still returns the codes when this session can't be kept", async () => {
    mocks.confirmEnrolment.mockResolvedValue({ ok: true, codes: ["AAAAA-BBBBB"], sessionVersion: 3 });
    mocks.updateSession.mockRejectedValueOnce(new Error("cookie write failed"));
    expect(await confirmTwoFactorAction(form({ code: "123456" }))).toEqual({ ok: true, codes: ["AAAAA-BBBBB"] });
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe("disableTwoFactorAction and regenerateBackupCodesAction", () => {
  it("need the password and a current code, checked inside the call", async () => {
    mocks.regenerateBackupCodes.mockResolvedValue({ ok: true, codes: [], sessionVersion: 2 });
    await disableTwoFactorAction(form({ password: "pw", code: "123456" }));
    expect(mocks.confirmIdentity).toHaveBeenCalledWith("u1", { password: "pw", code: "123456" });
    expect(refreshedTo(0)).toBe(1);
    await regenerateBackupCodesAction(form({ password: "pw", code: "ABCDE-FGHJK" }));
    expect(mocks.confirmIdentity).toHaveBeenLastCalledWith("u1", { password: "pw", code: "ABCDE-FGHJK" });
    expect(refreshedTo(1)).toBe(2);
  });

  it("change nothing when re-authentication fails", async () => {
    mocks.confirmIdentity.mockResolvedValue({ ok: false, error: "That code isn't right." });
    expect(await disableTwoFactorAction(form({ password: "pw", code: "000000" }))).toEqual({ ok: false, error: "That code isn't right." });
    expect(await regenerateBackupCodesAction(form({ password: "pw", code: "000000" }))).toEqual({ ok: false, error: "That code isn't right." });
    expect(mocks.disableTwoFactor).not.toHaveBeenCalled();
    expect(mocks.regenerateBackupCodes).not.toHaveBeenCalled();
    expect(mocks.updateSession).not.toHaveBeenCalled();
  });

  it("turn off and make new codes once re-authenticated", async () => {
    mocks.regenerateBackupCodes.mockResolvedValue({ ok: true, codes: ["XXXXX-YYYYY"], sessionVersion: 6 });
    expect(await disableTwoFactorAction(form({ password: "pw", code: "123456" }))).toEqual({ ok: true });
    expect(mocks.disableTwoFactor).toHaveBeenCalledWith("u1");
    expect(await regenerateBackupCodesAction(form({ password: "pw", code: "123456" }))).toEqual({ ok: true, codes: ["XXXXX-YYYYY"] });
  });

  it("keep this session signed in at the new version (Ziki #389)", async () => {
    mocks.disableTwoFactor.mockResolvedValue(5);
    await disableTwoFactorAction(form({ password: "pw", code: "123456" }));
    expect(refreshedTo(4)).toBe(5);

    mocks.regenerateBackupCodes.mockResolvedValue({ ok: true, codes: ["XXXXX-YYYYY"], sessionVersion: 6 });
    await regenerateBackupCodesAction(form({ password: "pw", code: "123456" }));
    expect(refreshedTo(5)).toBe(6);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.hoisted(() => vi.fn());
const deleteUserAccount = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const cookies = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-helpers", () => ({ requireUser }));
vi.mock("@/lib/user-offboarding", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/user-offboarding")>();
  return {
    ...original,
    deleteUserAccount,
  };
});
vi.mock("@/auth", () => ({ signOut }));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { deleteAccountAction } from "./account";
import { SoleTenantOwnerError } from "@/lib/user-offboarding";
import { ACTIVE_ROLE_COOKIE_NAME } from "@/lib/roles";

describe("deleteAccountAction (#571)", () => {
  const mockCookieStore = {
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cookies.mockResolvedValue(mockCookieStore);
    requireUser.mockResolvedValue({ id: "user-test" });
  });

  it("returns error message when user is the sole owner of an organization", async () => {
    deleteUserAccount.mockRejectedValue(new SoleTenantOwnerError("Alpha Workspace"));

    const result = await deleteAccountAction();

    expect(result).toEqual({
      ok: false,
      error: 'Cannot delete account while you are the sole owner of "Alpha Workspace". Transfer ownership or delete the organization first.',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("calls deleteUserAccount and signs out when deletion succeeds", async () => {
    deleteUserAccount.mockResolvedValue({ ok: true, userId: "user-test" });
    signOut.mockResolvedValue(undefined);

    const result = await deleteAccountAction();

    expect(result).toEqual({ ok: true });
    expect(deleteUserAccount).toHaveBeenCalledWith(expect.anything(), "user-test");
    expect(mockCookieStore.delete).toHaveBeenCalledWith(ACTIVE_ROLE_COOKIE_NAME);
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/login?deleted=1" });
  });

  it("re-throws redirect error from signOut", async () => {
    deleteUserAccount.mockResolvedValue({ ok: true, userId: "user-test" });
    const redirectErr = new Error("NEXT_REDIRECT");
    signOut.mockRejectedValue(redirectErr);

    await expect(deleteAccountAction()).rejects.toThrow("NEXT_REDIRECT");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());
const isTwoFactorEnabled = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/two-factor", () => ({ isTwoFactorEnabled }));

import { googleSignInBlockedByTwoFactor } from "./google-two-factor";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("googleSignInBlockedByTwoFactor (#388)", () => {
  it("lets a new address through", async () => {
    findUnique.mockResolvedValue(null);
    await expect(googleSignInBlockedByTwoFactor("New@x.dev")).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledWith({
      where: { email: "new@x.dev" },
      select: { id: true },
    });
    expect(isTwoFactorEnabled).not.toHaveBeenCalled();
  });

  it("lets an existing account through when two-factor is off", async () => {
    findUnique.mockResolvedValue({ id: "user-1" });
    isTwoFactorEnabled.mockResolvedValue(false);
    await expect(googleSignInBlockedByTwoFactor("a@x.dev")).resolves.toBe(false);
  });

  it("blocks an existing account that has two-factor on", async () => {
    findUnique.mockResolvedValue({ id: "user-1" });
    isTwoFactorEnabled.mockResolvedValue(true);
    await expect(googleSignInBlockedByTwoFactor("a@x.dev")).resolves.toBe(true);
    expect(isTwoFactorEnabled).toHaveBeenCalledWith("user-1");
  });
});

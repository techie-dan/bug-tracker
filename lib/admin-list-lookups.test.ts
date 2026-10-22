import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { activeBulkOptions, loadBulkAssignees } from "./admin-list-lookups";

const findMany = vi.mocked(prisma.user.findMany);

describe("activeBulkOptions", () => {
  it("keeps active rows and drops the inactive ones", () => {
    expect(
      activeBulkOptions([
        { id: "a", name: "Web", isActive: true },
        { id: "b", name: "Old", isActive: false },
      ]),
    ).toEqual([{ id: "a", name: "Web" }]);
  });
});

describe("loadBulkAssignees", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("returns admins and super admins who belong to the active tenant", async () => {
    findMany.mockResolvedValue([
      { id: "u1", name: "Ada" },
      { id: "u2", name: "Grace" },
    ] as never);

    await expect(loadBulkAssignees("tenant-1")).resolves.toEqual([
      { id: "u1", name: "Ada" },
      { id: "u2", name: "Grace" },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        role: { in: ["admin", "super_admin"] },
        memberships: { some: { tenantId: "tenant-1" } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  });

  it("returns nothing when the lookup fails, instead of throwing", async () => {
    findMany.mockRejectedValue(new Error('column "role" does not exist'));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(loadBulkAssignees("tenant-1")).resolves.toEqual([]);

    error.mockRestore();
  });
});

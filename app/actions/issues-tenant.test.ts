import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tenant scoping of the issue actions (#425): issues are filed into the
 * reporter's tenant, someone with no membership can't file at all, and an
 * issue in another tenant is "not found".
 */

vi.mock("@/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant-context")>()),
  currentTenantIdFor: vi.fn(),
  defaultProjectIdFor: vi.fn(async () => "project-zedu"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyLater: vi.fn() }));
vi.mock("@/lib/session-user", () => ({ resolveSessionUserId: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/tenant-access", () => ({
  currentTenantAccess: vi.fn(async () => ({
    tenantId: "tenant-zedu",
    tenantName: "Zedu",
    tenantSlug: "zedu",
    membershipRole: "member",
    admin: false,
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bug: { findUnique: vi.fn(), create: vi.fn() },
    projectArea: { findFirst: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor, NO_TENANT_MESSAGE } from "@/lib/tenant-context";
import { createBugAction, updateBugAction } from "./issues";

const db = prisma as unknown as {
  bug: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  projectArea: { findFirst: ReturnType<typeof vi.fn> };
  $executeRaw: ReturnType<typeof vi.fn>;
};
const tenantOf = currentTenantIdFor as unknown as ReturnType<typeof vi.fn>;

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const report = form({
  title: "Login button does nothing",
  description: "Clicking Login on the sign-in page does nothing at all, on Chrome and Firefox.",
  proofLinks: "",
});

describe("issue actions are tenant-scoped (#425)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", role: "user" });
  });

  it("refuses to file an issue for someone with no membership", async () => {
    tenantOf.mockResolvedValue(null);
    expect(await createBugAction(report)).toEqual({ error: NO_TENANT_MESSAGE });
    expect(db.bug.create).not.toHaveBeenCalled();
  });

  it("files the issue into the reporter's tenant and project", async () => {
    tenantOf.mockResolvedValue("tenant-zedu");
    db.bug.create.mockRejectedValue(new Error("stop after create"));
    await createBugAction(report).catch(() => undefined);
    expect(db.bug.create).toHaveBeenCalledTimes(1);
    expect(db.bug.create.mock.calls[0][0].data).toMatchObject({
      tenantId: "tenant-zedu",
      projectId: "project-zedu",
      beneficiaryUserId: "user-1",
    });
  });

  it("accepts an area only when it belongs to the default project", async () => {
    tenantOf.mockResolvedValue("tenant-zedu");
    db.projectArea.findFirst.mockResolvedValue({ id: "area-web" });
    db.bug.create.mockRejectedValue(new Error("stop after create"));
    await createBugAction(form({
      title: "Login button does nothing",
      description: "Clicking Login on the sign-in page does nothing at all, on Chrome and Firefox.",
      proofLinks: "",
      areaId: "area-web",
    })).catch(() => undefined);
    expect(db.projectArea.findFirst).toHaveBeenCalledWith({
      where: { id: "area-web", projectId: "project-zedu" },
      select: { id: true },
    });
    expect(db.bug.create.mock.calls[0][0].data.areaId).toBe("area-web");
  });

  it("rejects an area from another project before saving", async () => {
    tenantOf.mockResolvedValue("tenant-zedu");
    db.projectArea.findFirst.mockResolvedValue(null);
    const result = await createBugAction(form({
      title: "Login button does nothing",
      description: "Clicking Login on the sign-in page does nothing at all, on Chrome and Firefox.",
      proofLinks: "",
      areaId: "foreign-area",
    }));
    expect(result).toMatchObject({ error: "Area not found in this project.", field: "areaId" });
    expect(db.bug.create).not.toHaveBeenCalled();
  });

  it("repairs the issue-number sequence and saves on the retry", async () => {
    tenantOf.mockResolvedValue("tenant-zedu");
    db.$executeRaw.mockResolvedValue(0);
    db.bug.create
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "6",
          meta: { target: ["number"] },
        }),
      )
      .mockResolvedValueOnce({ id: "bug-new", title: "Login button does nothing" });
    await createBugAction(report);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.bug.create).toHaveBeenCalledTimes(2);
  });

  it("returns a readable error for a unique violation that is not the issue number", async () => {
    tenantOf.mockResolvedValue("tenant-zedu");
    db.bug.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6",
        meta: { target: ["title"] },
      }),
    );
    expect(await createBugAction(report)).toEqual({
      error: "That issue could not be saved because it conflicts with an existing one. Try again.",
    });
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("treats an issue in another tenant as not found", async () => {
    tenantOf.mockResolvedValue("tenant-zedu");
    db.bug.findUnique.mockResolvedValue(null);
    expect(await updateBugAction("bug-in-acme", form({ status: "resolved" }))).toEqual({
      error: "Issue not found",
    });
    expect(db.bug.findUnique.mock.calls[0][0].where).toEqual({ id: "bug-in-acme", tenantId: "tenant-zedu" });
  });
});

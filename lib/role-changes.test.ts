import { describe, expect, it, vi } from "vitest";
import { changeUserRole, refuseRoleChange, ROLE_CHANGE_ERRORS } from "./role-changes";

const admin = { id: "admin-1", role: "admin" as const };
const plain = { id: "user-1", role: "user" as const };
const root = { id: "root-1", role: "super_admin" as const };

describe("refuseRoleChange", () => {
  it("allows promoting a plain user to admin", () => {
    expect(refuseRoleChange("root-1", plain, "admin")).toBeNull();
  });

  it("allows demoting an admin back to user", () => {
    expect(refuseRoleChange("root-1", admin, "user")).toBeNull();
  });

  it("refuses to change the caller's own role", () => {
    expect(refuseRoleChange("admin-1", admin, "user")).toBe("self");
    expect(refuseRoleChange("root-1", root, "admin")).toBe("self");
  });

  it("refuses to change another super admin's role", () => {
    expect(refuseRoleChange("root-1", { id: "root-2", role: "super_admin" }, "user")).toBe(
      "super-admin",
    );
  });

  it("refuses a no-op promote", () => {
    expect(refuseRoleChange("root-1", admin, "admin")).toBe("already-admin");
  });

  it("refuses a no-op demote", () => {
    expect(refuseRoleChange("root-1", plain, "user")).toBe("already-user");
  });

  it("reports a missing target", () => {
    expect(refuseRoleChange("root-1", null, "admin")).toBe("not-found");
  });
});

describe("ROLE_CHANGE_ERRORS", () => {
  it("has a message for every refusal reason", () => {
    for (const reason of Object.keys(ROLE_CHANGE_ERRORS)) {
      expect(ROLE_CHANGE_ERRORS[reason as keyof typeof ROLE_CHANGE_ERRORS]).toBeTruthy();
    }
  });
});

describe("changeUserRole with session rotation (#655)", () => {
  it("escalates user to admin, bumps sessionVersion, and logs audit", async () => {
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: "user-1", role: "user", email: "user@zedu.test", sessionVersion: 3 }),
        update: vi.fn().mockResolvedValue({ id: "user-1", role: "admin", sessionVersion: 4 }),
      },
    };

    const result = await changeUserRole(db as never, root, { targetUserId: "user-1", nextRole: "admin" });
    expect(result).toEqual({ ok: true, user: { id: "user-1", role: "admin", sessionVersion: 4 } });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        role: "admin",
        sessionVersion: { increment: 1 },
      },
      select: { id: true, role: true, sessionVersion: true },
    });
  });

  it("downgrades admin to user, bumps sessionVersion, and logs audit", async () => {
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin", email: "admin@zedu.test", sessionVersion: 1 }),
        update: vi.fn().mockResolvedValue({ id: "admin-1", role: "user", sessionVersion: 2 }),
      },
    };

    const result = await changeUserRole(db as never, root, { targetUserId: "admin-1", nextRole: "user" });
    expect(result).toEqual({ ok: true, user: { id: "admin-1", role: "user", sessionVersion: 2 } });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "admin-1" },
      data: {
        role: "user",
        sessionVersion: { increment: 1 },
      },
      select: { id: true, role: true, sessionVersion: true },
    });
  });

  it("refuses to change own role without bumping sessionVersion", async () => {
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: "root-1", role: "super_admin", email: "root@zedu.test", sessionVersion: 0 }),
        update: vi.fn(),
      },
    };

    const result = await changeUserRole(db as never, root, { targetUserId: "root-1", nextRole: "admin" });
    expect(result).toEqual({ ok: false, error: ROLE_CHANGE_ERRORS.self });
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
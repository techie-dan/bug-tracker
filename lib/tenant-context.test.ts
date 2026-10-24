import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet, set: vi.fn() }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  bugInTenant,
  commentInTenant,
  defaultProjectIdFor,
  isMissingTenantColumnError,
  notificationInTenant,
  pickTenantId,
  tenantIdForUser,
} from "./tenant-context";

const zedu = { tenantId: "tenant-zedu", tenant: { slug: "zedu" } };
const other = { tenantId: "tenant-other", tenant: { slug: "acme" } };

/** A tiny stand-in for Postgres: does `row` match a `{ tenantId }` scope? */
function matches(row: { tenantId: string }, scope: ReturnType<typeof bugInTenant>): boolean {
  return typeof scope.tenantId === "string"
    ? row.tenantId === scope.tenantId
    : scope.tenantId.in.includes(row.tenantId);
}

beforeEach(() => {
  cookieGet.mockReturnValue(undefined);
});

describe("tenant context (#425)", () => {
  describe("pickTenantId", () => {
    it("opens Zedu for a Zedu member, even with other memberships", () => {
      expect(pickTenantId([other, zedu])).toBe("tenant-zedu");
    });

    it("opens the oldest membership for someone outside Zedu", () => {
      expect(pickTenantId([other])).toBe("tenant-other");
    });

    it("gives a new account with no membership no tenant at all", () => {
      expect(pickTenantId([])).toBeNull();
    });

    it("opens the tenant picked on this device, when they belong to it (#444)", () => {
      expect(pickTenantId([zedu, other], "tenant-other")).toBe("tenant-other");
    });

    it("ignores a pick they don't belong to, so a forged cookie opens nothing new (#444)", () => {
      expect(pickTenantId([zedu], "tenant-other")).toBe("tenant-zedu");
      // A brand-new account can't open Zedu by naming it.
      expect(pickTenantId([], "tenant-zedu")).toBeNull();
    });
  });

  describe("tenantIdForUser", () => {
    it("resolves the tenant from the person's memberships", async () => {
      const findMany = vi.fn().mockResolvedValue([zedu]);
      const db = { membership: { findMany } } as never;
      expect(await tenantIdForUser(db, "user-1")).toBe("tenant-zedu");
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1", tenant: { archivedAt: null } },
        }),
      );
    });

    it("has no tenant without a signed-in person, and doesn't query", async () => {
      const findMany = vi.fn();
      const db = { membership: { findMany } } as never;
      expect(await tenantIdForUser(db, undefined)).toBeNull();
      expect(findMany).not.toHaveBeenCalled();
    });

    it("has no tenant for a signed-in person with no membership", async () => {
      const db = { membership: { findMany: vi.fn().mockResolvedValue([]) } } as never;
      expect(await tenantIdForUser(db, "new-user")).toBeNull();
      expect(await tenantIdForUser(db, "new-user", "tenant-zedu")).toBeNull();
    });

    it("checks the pick against the person's memberships (#444)", async () => {
      const db = { membership: { findMany: vi.fn().mockResolvedValue([zedu, other]) } } as never;
      expect(await tenantIdForUser(db, "user-1", "tenant-other")).toBe("tenant-other");
      expect(await tenantIdForUser(db, "user-1", "tenant-someone-elses")).toBe("tenant-zedu");
    });
  });

  describe("scopes", () => {
    const issues = [
      { id: "zedu-1", tenantId: "tenant-zedu" },
      { id: "other-1", tenantId: "tenant-other" },
    ];

    it("keeps a second tenant's issues out of the Zedu session", () => {
      const visible = issues.filter((issue) => matches(issue, bugInTenant("tenant-zedu")));
      expect(visible.map((i) => i.id)).toEqual(["zedu-1"]);
    });

    it("shows no issues at all without a tenant", () => {
      expect(bugInTenant(null)).toEqual({ tenantId: { in: [] } });
      expect(issues.filter((issue) => matches(issue, bugInTenant(null)))).toEqual([]);
    });

    it("scopes comments through their issue", () => {
      expect(commentInTenant("tenant-zedu")).toEqual({ bug: { tenantId: "tenant-zedu" } });
    });

    it("keeps personal notifications in the active tenant and supports all workspaces", () => {
      expect(notificationInTenant("tenant-zedu")).toEqual({
        OR: [{ tenantId: null }, { tenantId: "tenant-zedu" }, { kind: "tenant_invite" }],
      });
      expect(notificationInTenant(null)).toEqual({
        OR: [{ tenantId: null }, { kind: "tenant_invite" }],
      });
      expect(notificationInTenant("tenant-zedu", true)).toEqual({});
    });
  });

  describe("defaultProjectIdFor", () => {
    it("files new issues into the tenant's Zedu project", async () => {
      const db = {
        project: {
          findMany: vi.fn().mockResolvedValue([
            { id: "project-web", slug: "web" },
            { id: "project-zedu", slug: "zedu" },
          ]),
        },
      } as never;
      expect(await defaultProjectIdFor(db, "tenant-zedu")).toBe("project-zedu");
    });

    it("files new issues into the project chosen in the header", async () => {
      cookieGet.mockReturnValue({ value: "project-web" });
      const db = {
        project: {
          findMany: vi.fn().mockResolvedValue([
            { id: "project-web", slug: "web" },
            { id: "project-zedu", slug: "zedu" },
          ]),
        },
      } as never;
      expect(await defaultProjectIdFor(db, "tenant-zedu")).toBe("project-web");
    });

    it("falls back to the oldest project, or none", async () => {
      const one = { project: { findMany: vi.fn().mockResolvedValue([{ id: "p1", slug: "web" }]) } } as never;
      const none = { project: { findMany: vi.fn().mockResolvedValue([]) } } as never;
      expect(await defaultProjectIdFor(one, "t")).toBe("p1");
      expect(await defaultProjectIdFor(none, "t")).toBeNull();
    });
  });

  describe("isMissingTenantColumnError (#439)", () => {
    it("recognises a missing tenant or project column", () => {
      expect(isMissingTenantColumnError(new Error("The column `tenantId` does not exist in the current database."))).toBe(true);
      expect(isMissingTenantColumnError(new Error("The column `Bug.projectId` does not exist in the current database."))).toBe(true);
      expect(isMissingTenantColumnError(new Error('column "tenantId" of relation "Bug" does not exist'))).toBe(true);
      expect(isMissingTenantColumnError({ code: "P2022", meta: { column: "Bug.tenantId" } })).toBe(true);
    });

    it("ignores a query that merely mentions tenantId, and other missing columns", () => {
      const printedQuery = new Error(`Invalid \`prisma.bug.count()\` invocation:

{
  where: {
    tenantId: { in: [] },
    projectId: "project-zedu",
    isDeleted: false
  }
}

Timed out fetching a new connection from the connection pool.`);
      expect(isMissingTenantColumnError(printedQuery)).toBe(false);
      expect(isMissingTenantColumnError(new Error("The column `voteCount` does not exist in the current database."))).toBe(false);
      expect(isMissingTenantColumnError({ code: "P2022", meta: { column: "Bug.milestoneId" } })).toBe(false);
    });
  });
});

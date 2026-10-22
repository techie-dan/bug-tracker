/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import {
  discoverableTenants,
  pendingTenantJoinRequests,
  requestTenantMembership,
  reviewTenantMembershipRequest,
  requestsForUser,
  tenantSummary,
} from "./tenant-join-requests";

describe("tenant-join-requests", () => {
  it("discovers public workspaces excluding caller memberships", async () => {
    const db = {
      tenant: {
        findMany: vi.fn().mockResolvedValue([{ id: "t1", name: "Zedu", slug: "zedu", discoverable: true }]),
      },
    } as any;

    const tenants = await discoverableTenants(db, "user-1");
    expect(tenants).toHaveLength(1);
    expect(tenants[0]?.memberships).toEqual([]);
    expect(db.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { discoverable: true, memberships: { none: { userId: "user-1" } } },
      }),
    );
  });

  it("names the owner without failing when that account is gone", async () => {
    const db = {
      tenant: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "t1",
            name: "Zedu",
            slug: "zedu",
            description: null,
            memberships: [{ userId: "ada" }, { userId: "gone" }],
            joinRequests: [],
          },
          {
            id: "t2",
            name: "Empty",
            slug: "empty",
            description: null,
            memberships: [{ userId: "gone" }],
            joinRequests: [],
          },
        ]),
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: "ada", name: "Ada" }]) },
    } as any;

    const tenants = await discoverableTenants(db, "user-1");
    expect(tenants.map((tenant) => tenant.memberships)).toEqual([[{ user: { name: "Ada" } }], []]);
  });

  it("lists pending join requests and skips a requester whose account is gone", async () => {
    const requestedAt = new Date("2026-01-01T00:00:00Z");
    const db = {
      tenantJoinRequest: {
        findMany: vi.fn().mockResolvedValue([
          { id: "r1", requestedAt, userId: "ada" },
          { id: "r2", requestedAt, userId: "gone" },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: "ada", name: "Ada", email: "ada@example.com" }]),
      },
    } as any;

    const requests = await pendingTenantJoinRequests(db, "t1");
    expect(requests).toEqual([
      { id: "r1", requestedAt, user: { id: "ada", name: "Ada", email: "ada@example.com" } },
    ]);
    expect(db.tenantJoinRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "t1", status: "pending" },
        select: { id: true, requestedAt: true, userId: true },
      }),
    );
  });

  it("returns no join requests when that table is not migrated yet", async () => {
    const db = {
      tenantJoinRequest: {
        findMany: vi.fn().mockRejectedValue({
          code: "P2021",
          meta: { table: "public.TenantJoinRequest" },
          message: "The table `public.TenantJoinRequest` does not exist in the current database.",
        }),
      },
    } as any;

    await expect(pendingTenantJoinRequests(db, "t1")).resolves.toEqual([]);
    await expect(requestsForUser(db, "ada")).resolves.toEqual([]);
  });

  it("does not hide an unrelated join-request failure", async () => {
    const db = {
      tenantJoinRequest: { findMany: vi.fn().mockRejectedValue(new Error("connection refused")) },
    } as any;

    await expect(pendingTenantJoinRequests(db, "t1")).rejects.toThrow(/connection refused/);
  });

  it("reads counts when discovery columns are missing and keeps them when they exist", async () => {
    const missing = {
      tenant: {
        findUnique: vi
          .fn()
          .mockRejectedValueOnce({ code: "P2022", meta: { column: "Tenant.description" } })
          .mockResolvedValueOnce({ _count: { memberships: 4, projects: 2 } }),
      },
    } as any;
    await expect(tenantSummary(missing, "t1")).resolves.toEqual({
      description: null,
      discoverable: false,
      memberships: 4,
      projects: 2,
    });

    const present = {
      tenant: {
        findUnique: vi.fn().mockResolvedValue({
          description: "Hi",
          discoverable: true,
          _count: { memberships: 1, projects: 1 },
        }),
      },
    } as any;
    await expect(tenantSummary(present, "t1")).resolves.toEqual({
      description: "Hi",
      discoverable: true,
      memberships: 1,
      projects: 1,
    });
  });

  it("does not treat a query that mentions description as a missing discovery column", async () => {
    const db = {
      tenant: {
        findUnique: vi.fn().mockRejectedValue(new Error('column "voteCount" does not exist')),
      },
    } as any;

    await expect(tenantSummary(db, "t1")).rejects.toThrow(/voteCount/);
    expect(db.tenant.findUnique).toHaveBeenCalledTimes(1);
  });

  it("rejects request if tenantId is missing or user already belongs", async () => {
    const db = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({ id: "m1" }),
      },
    } as any;

    const empty = await requestTenantMembership(db, "u1", "");
    expect(empty).toEqual({ ok: false, error: "Choose a workspace." });

    const member = await requestTenantMembership(db, "u1", "t1");
    expect(member).toEqual({ ok: false, error: "You already belong to this workspace." });
  });

  it("creates a new join request when not existing", async () => {
    const db = {
      membership: { findUnique: vi.fn().mockResolvedValue(null) },
      tenant: { findFirst: vi.fn().mockResolvedValue({ id: "t1", name: "Tenant 1", slug: "t1" }) },
      tenantJoinRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "req-1" }),
      },
    } as any;

    const res = await requestTenantMembership(db, "u1", "t1");
    expect(res).toEqual({
      ok: true,
      requestId: "req-1",
      tenantId: "t1",
      tenantName: "Tenant 1",
      slug: "t1",
      created: true,
    });
  });

  it("reopens existing non-pending request", async () => {
    const db = {
      membership: { findUnique: vi.fn().mockResolvedValue(null) },
      tenant: { findFirst: vi.fn().mockResolvedValue({ id: "t1", name: "Tenant 1", slug: "t1" }) },
      tenantJoinRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: "req-1", status: "rejected" }),
        update: vi.fn().mockResolvedValue({ id: "req-1" }),
      },
    } as any;

    const res = await requestTenantMembership(db, "u1", "t1");
    expect(res).toEqual({
      ok: true,
      requestId: "req-1",
      tenantId: "t1",
      tenantName: "Tenant 1",
      slug: "t1",
      created: true,
    });
  });

  it("reviews request: adds member on approval", async () => {
    const req = {
      id: "req-1",
      status: "pending",
      userId: "u1",
      tenantId: "t1",
      tenant: { name: "Tenant 1", slug: "t1" },
      user: { name: "User 1", email: "user@example.com" },
    };
    const tx = {
      tenantJoinRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      membership: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const db = {
      tenantJoinRequest: {
        findUnique: vi.fn().mockResolvedValue(req),
      },
      $transaction: vi.fn().mockImplementation((cb) => cb(tx)),
    } as any;

    const res = await reviewTenantMembershipRequest(db, {
      requestId: "req-1",
      reviewerId: "reviewer-1",
      status: "approved",
    });

    expect(res).toEqual({
      ok: true,
      requestId: "req-1",
      status: "approved",
      tenantId: "t1",
      tenantName: "Tenant 1",
      slug: "t1",
      userId: "u1",
      userName: "User 1",
    });
    expect(tx.membership.createMany).toHaveBeenCalled();
  });
});

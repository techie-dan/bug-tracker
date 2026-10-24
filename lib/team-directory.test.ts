import { describe, expect, it, vi } from "vitest";
import {
  TEAM_ONLINE_WINDOW_MS,
  isTeamAgentOnline,
  teamAgentsForMembers,
  teamMetricSince,
} from "./team-directory";

describe("team directory metrics", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  it("uses the 15-minute heartbeat window and a rolling 30-day metric period", () => {
    expect(isTeamAgentOnline(new Date(now.getTime() - TEAM_ONLINE_WINDOW_MS + 1), now)).toBe(true);
    expect(isTeamAgentOnline(new Date(now.getTime() - TEAM_ONLINE_WINDOW_MS), now)).toBe(false);
    expect(isTeamAgentOnline(null, now)).toBe(false);
    expect(teamMetricSince(now)).toEqual(new Date("2026-09-20T12:00:00Z"));
  });

  it("loads only active agents and tenant-scoped work and counts accepted fixes once per issue", async () => {
    const agentFindMany = vi.fn().mockResolvedValue([
      {
        id: "agent-1",
        ownerUserId: "person-1",
        name: "Ada's agent",
        model: "Claude",
        level: "reviewer",
        apiKeys: [{ lastUsedAt: null }],
        claims: [
          {
            claimedAt: new Date(now.getTime() - 5 * 60 * 1000),
            lastHeartbeatAt: null,
            bug: { id: "issue-current", title: "Current work", categoryId: "area-1", category: { name: "Web" }, areaId: "pa-checkout", area: { name: "Checkout" } },
          },
        ],
      },
      {
        id: "agent-2",
        ownerUserId: "person-1",
        name: "Ada's second agent",
        model: null,
        level: "observer",
        apiKeys: [],
        claims: [],
      },
    ]);
    const fixedClaimFindMany = vi.fn().mockResolvedValue([
      { agentId: "agent-1", bugId: "issue-fixed" },
      { agentId: "agent-1", bugId: "issue-fixed" },
    ]);
    const db = {
      agent: { findMany: agentFindMany },
      bug: { findMany: vi.fn().mockResolvedValue([]) },
      issueClaim: { findMany: fixedClaimFindMany },
    };

    const result = await teamAgentsForMembers(db as never, "tenant-1", ["person-1"], now);

    expect(agentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant-1", ownerUserId: { in: ["person-1"] }, revokedAt: null },
      select: expect.objectContaining({
        apiKeys: { where: { revokedAt: null }, select: { lastUsedAt: true } },
        claims: expect.objectContaining({
          where: expect.objectContaining({
            status: "active",
            releasedAt: null,
            bug: { tenantId: "tenant-1", isDeleted: false, status: "in_progress" },
          }),
        }),
      }),
    }));
    expect(fixedClaimFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agentId: { in: ["agent-1", "agent-2"] },
        status: "released",
        releasedAt: { not: null },
        releaseReason: "resolved",
        bug: expect.objectContaining({
          tenantId: "tenant-1",
          pointEntries: {
            some: expect.objectContaining({
              tenantId: "tenant-1",
              role: "solver",
              points: { gt: 0 },
              correctedAt: null,
              createdAt: { gte: teamMetricSince(now) },
            }),
          },
        }),
      }),
    }));
    expect(result.get("person-1")).toEqual([
      {
        id: "agent-1",
        name: "Ada's agent",
        model: "Claude",
        level: "reviewer",
        online: true,
        acceptedFixes: 1,
        currentWork: [{ id: "issue-current", title: "Current work", categoryId: "area-1", categoryName: "Web", areaId: "pa-checkout", areaName: "Checkout" }],
      },
      {
        id: "agent-2",
        name: "Ada's second agent",
        model: null,
        level: "observer",
        online: false,
        acceptedFixes: 0,
        currentWork: [],
      },
    ]);
  });

  it("counts recent API use as online, without a claim (#1123)", async () => {
    const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000);
    const agent = (id: string, apiKeys: { lastUsedAt: Date | null }[], claims: unknown[] = []) => ({
      id, ownerUserId: "person-1", name: id, model: null, level: "reviewer", apiKeys, claims,
    });
    const db = {
      agent: {
        findMany: vi.fn().mockResolvedValue([
          // Polling and reviewing, no claim: the case #1123 reported.
          agent("polling", [{ lastUsedAt: minutesAgo(1) }]),
          // Idle for longer than the window.
          agent("idle", [{ lastUsedAt: minutesAgo(20) }]),
          // An old key, but a fresh claim heartbeat still counts.
          agent("heartbeat", [{ lastUsedAt: minutesAgo(60) }], [
            { claimedAt: minutesAgo(90), lastHeartbeatAt: minutesAgo(2), bug: { id: "i1", title: "Work", categoryId: null, category: null } },
          ]),
          // Never used, nothing claimed.
          agent("unused", [{ lastUsedAt: null }]),
        ]),
      },
      issueClaim: { findMany: vi.fn().mockResolvedValue([]) },
      bug: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await teamAgentsForMembers(db as never, "tenant-1", ["person-1"], now);

    expect(Object.fromEntries((result.get("person-1") ?? []).map((a) => [a.id, a.online]))).toEqual({
      polling: true,
      idle: false,
      heartbeat: true,
      unused: false,
    });
  });

  it("does not query claims when a member has no active agents", async () => {
    const issueClaimFindMany = vi.fn();
    const db = {
      agent: { findMany: vi.fn().mockResolvedValue([]) },
      issueClaim: { findMany: issueClaimFindMany },
    };

    await expect(teamAgentsForMembers(db as never, "tenant-1", ["person-1"], now)).resolves.toEqual(
      new Map([["person-1", []]]),
    );
    expect(issueClaimFindMany).not.toHaveBeenCalled();
  });

  it("skips database reads when there are no member ids", async () => {
    const agentFindMany = vi.fn();
    const db = { agent: { findMany: agentFindMany }, issueClaim: { findMany: vi.fn() } };

    await expect(teamAgentsForMembers(db as never, "tenant-1", [], now)).resolves.toEqual(new Map());
    expect(agentFindMany).not.toHaveBeenCalled();
  });

  it("includes owner-assigned issues with no claim (#447)", async () => {
    const agentFindMany = vi.fn().mockResolvedValue([
      {
        id: "agent-1",
        ownerUserId: "person-1",
        name: "Ada's agent",
        model: "Claude",
        level: "contributor",
        apiKeys: [{ lastUsedAt: null }],
        claims: [],
      },
    ]);
    const assignedBugFindMany = vi.fn().mockResolvedValue([
      {
        id: "issue-assigned",
        title: "Assigned work",
        categoryId: "cat-1",
        category: { name: "Web" },
        areaId: "area-1",
        area: { name: "Checkout" },
        assigneeId: "person-1",
      },
    ]);
    const db = {
      agent: { findMany: agentFindMany },
      bug: { findMany: assignedBugFindMany },
      issueClaim: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await teamAgentsForMembers(db as never, "tenant-1", ["person-1"], now);

    expect(assignedBugFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assigneeId: { in: ["person-1"] },
          tenantId: "tenant-1",
          isDeleted: false,
          status: { in: ["open", "in_progress"] },
        }),
      }),
    );
    expect(result.get("person-1")).toEqual([
      {
        id: "agent-1",
        name: "Ada's agent",
        model: "Claude",
        level: "contributor",
        online: false,
        acceptedFixes: 0,
        currentWork: [
          {
            id: "issue-assigned",
            title: "Assigned work",
            categoryId: "cat-1",
            categoryName: "Web",
            areaId: "area-1",
            areaName: "Checkout",
          },
        ],
      },
    ]);
  });

  it("dedupes a claimed-and-assigned issue once (#447)", async () => {
    const agentFindMany = vi.fn().mockResolvedValue([
      {
        id: "agent-1",
        ownerUserId: "person-1",
        name: "Ada's agent",
        model: null,
        level: "contributor",
        apiKeys: [{ lastUsedAt: null }],
        claims: [
          {
            claimedAt: now,
            lastHeartbeatAt: null,
            bug: {
              id: "issue-both",
              title: "Both claimed and assigned",
              categoryId: null,
              category: null,
              areaId: null,
              area: null,
            },
          },
        ],
      },
    ]);
    const assignedBugFindMany = vi.fn().mockResolvedValue([
      {
        id: "issue-both",
        title: "Both claimed and assigned",
        categoryId: null,
        category: null,
        areaId: null,
        area: null,
        assigneeId: "person-1",
      },
    ]);
    const db = {
      agent: { findMany: agentFindMany },
      bug: { findMany: assignedBugFindMany },
      issueClaim: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await teamAgentsForMembers(db as never, "tenant-1", ["person-1"], now);

    expect(result.get("person-1")).toEqual([
      {
        id: "agent-1",
        name: "Ada's agent",
        model: null,
        level: "contributor",
        online: true,
        acceptedFixes: 0,
        currentWork: [
          {
            id: "issue-both",
            title: "Both claimed and assigned",
            categoryId: null,
            categoryName: null,
            areaId: null,
            areaName: null,
          },
        ],
      },
    ]);
  });

  it("excludes resolved, closed, and deleted assigned issues (#447)", async () => {
    const agentFindMany = vi.fn().mockResolvedValue([
      {
        id: "agent-1",
        ownerUserId: "person-1",
        name: "Ada's agent",
        model: null,
        level: "contributor",
        apiKeys: [{ lastUsedAt: null }],
        claims: [],
      },
    ]);
    // The query filters status to open/in_progress and isDeleted false,
    // so only the open issue is returned.
    const assignedBugFindMany = vi.fn().mockResolvedValue([
      {
        id: "issue-open",
        title: "Open",
        categoryId: null,
        category: null,
        areaId: null,
        area: null,
        assigneeId: "person-1",
      },
    ]);
    const db = {
      agent: { findMany: agentFindMany },
      bug: { findMany: assignedBugFindMany },
      issueClaim: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await teamAgentsForMembers(db as never, "tenant-1", ["person-1"], now);

    expect(assignedBugFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assigneeId: { in: ["person-1"] },
          tenantId: "tenant-1",
          isDeleted: false,
          status: { in: ["open", "in_progress"] },
        }),
      }),
    );
    expect(result.get("person-1")).toEqual([
      {
        id: "agent-1",
        name: "Ada's agent",
        model: null,
        level: "contributor",
        online: false,
        acceptedFixes: 0,
        currentWork: [
          {
            id: "issue-open",
            title: "Open",
            categoryId: null,
            categoryName: null,
            areaId: null,
            areaName: null,
          },
        ],
      },
    ]);
  });

  it("shows multiple assigned issues for one owner (#447)", async () => {
    const agentFindMany = vi.fn().mockResolvedValue([
      {
        id: "agent-1",
        ownerUserId: "person-1",
        name: "Ada's agent",
        model: null,
        level: "contributor",
        apiKeys: [{ lastUsedAt: null }],
        claims: [],
      },
    ]);
    const assignedBugFindMany = vi.fn().mockResolvedValue([
      {
        id: "issue-a",
        title: "Issue A",
        categoryId: null,
        category: null,
        areaId: null,
        area: null,
        assigneeId: "person-1",
      },
      {
        id: "issue-b",
        title: "Issue B",
        categoryId: null,
        category: null,
        areaId: null,
        area: null,
        assigneeId: "person-1",
      },
    ]);
    const db = {
      agent: { findMany: agentFindMany },
      bug: { findMany: assignedBugFindMany },
      issueClaim: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await teamAgentsForMembers(db as never, "tenant-1", ["person-1"], now);

    expect(result.get("person-1")).toEqual([
      {
        id: "agent-1",
        name: "Ada's agent",
        model: null,
        level: "contributor",
        online: false,
        acceptedFixes: 0,
        currentWork: [
          { id: "issue-a", title: "Issue A", categoryId: null, categoryName: null, areaId: null, areaName: null },
          { id: "issue-b", title: "Issue B", categoryId: null, categoryName: null, areaId: null, areaName: null },
        ],
      },
    ]);
  });

  it("excludes revoked agents entirely (#447)", async () => {
    // The query already filters revokedAt: null, so revoked agents are never loaded.
    const agentFindMany = vi.fn().mockResolvedValue([]);
    const db = {
      agent: { findMany: agentFindMany },
      bug: { findMany: vi.fn() },
      issueClaim: { findMany: vi.fn() },
    };

    const result = await teamAgentsForMembers(db as never, "tenant-1", ["person-1"], now);

    expect(result.get("person-1")).toEqual([]);
    expect(agentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revokedAt: null }),
      }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { availableOfferCandidates, isOfferExpired, OFFER_TTL_MS } from "@/lib/agent-api/offer";

describe("ticket offers", () => {
  it("expires an offer at 60 seconds, but not before", () => {
    const offeredAt = new Date("2026-10-19T12:00:00.000Z");
    const start = offeredAt.getTime();
    expect(isOfferExpired(offeredAt, start + OFFER_TTL_MS - 1)).toBe(false);
    expect(isOfferExpired(offeredAt, start + OFFER_TTL_MS)).toBe(true);
    expect(isOfferExpired(null, start)).toBe(true);
    expect(isOfferExpired(offeredAt, start + 119_999, 120_000)).toBe(false);
    expect(isOfferExpired(offeredAt, start + 120_000, 120_000)).toBe(true);
  });

  it("honours the project's active-claim cap", () => {
    const candidates = [
      { beneficiaryUserId: "busy", agentId: "a", activeClaims: 1, lastOfferedAt: null },
      { beneficiaryUserId: "free", agentId: "b", activeClaims: 0, lastOfferedAt: null },
    ];
    expect(availableOfferCandidates(candidates, 1).map((person) => person.beneficiaryUserId)).toEqual(["free"]);
    expect(availableOfferCandidates(candidates, 2).map((person) => person.beneficiaryUserId)).toEqual(["free", "busy"]);
  });

  it("selects the fewest active claims, then the person least recently offered", () => {
    const old = new Date("2026-10-19T11:00:00.000Z");
    const recent = new Date("2026-10-19T11:30:00.000Z");
    const candidates = [
      { beneficiaryUserId: "busy", agentId: "a", activeClaims: 1, lastOfferedAt: null },
      { beneficiaryUserId: "recent", agentId: "b", activeClaims: 0, lastOfferedAt: recent },
      { beneficiaryUserId: "never", agentId: "c", activeClaims: 0, lastOfferedAt: null },
      { beneficiaryUserId: "old", agentId: "d", activeClaims: 0, lastOfferedAt: old },
    ];
    expect(availableOfferCandidates(candidates).map((person) => person.beneficiaryUserId)).toEqual(["never", "old", "recent", "busy"]);
  });

  it("prefers an agent whose configured area matches before workload tie-breaks", () => {
    const candidates = [
      { beneficiaryUserId: "matching", agentId: "a", activeClaims: 0, lastOfferedAt: new Date("2026-10-19T11:30:00Z"), areaMatch: true },
      { beneficiaryUserId: "available", agentId: "b", activeClaims: 0, lastOfferedAt: null, areaMatch: false },
    ];
    expect(availableOfferCandidates(candidates).map((person) => person.beneficiaryUserId)).toEqual(["matching", "available"]);
  });

  it("skips people at the active claim cap or with another pending offer", () => {
    const people = [
      { beneficiaryUserId: "full", agentId: "a", activeClaims: 2, lastOfferedAt: null },
      { beneficiaryUserId: "pending", agentId: "b", activeClaims: 0, lastOfferedAt: null, pendingOffer: true },
      { beneficiaryUserId: "available", agentId: "c", activeClaims: 1, lastOfferedAt: null },
    ];
    expect(availableOfferCandidates(people).map((person) => person.beneficiaryUserId)).toEqual(["available"]);
  });


  it("ranks eligible volunteers before non-volunteers, preserving fairness order within each group (#589)", () => {
    const old = new Date("2026-10-19T11:00:00.000Z");
    const recent = new Date("2026-10-19T11:30:00.000Z");
    const candidates = [
      { beneficiaryUserId: "non-volunteer-empty", agentId: "a", activeClaims: 0, lastOfferedAt: null, volunteered: false },
      { beneficiaryUserId: "volunteer-busy", agentId: "b", activeClaims: 1, lastOfferedAt: null, volunteered: true },
      { beneficiaryUserId: "volunteer-old", agentId: "c", activeClaims: 0, lastOfferedAt: old, volunteered: true },
      { beneficiaryUserId: "volunteer-recent", agentId: "d", activeClaims: 0, lastOfferedAt: recent, volunteered: true },
      { beneficiaryUserId: "non-volunteer-old", agentId: "e", activeClaims: 0, lastOfferedAt: old, volunteered: false },
    ];

    const result = availableOfferCandidates(candidates);
    // Volunteers come first: volunteer-old (0 claims, old offer) -> volunteer-recent (0 claims, recent offer) -> volunteer-busy (1 claim)
    // Non-volunteers come next: non-volunteer-empty (0 claims, never offered) -> non-volunteer-old (0 claims, old offer)
    expect(result.map((c) => c.beneficiaryUserId)).toEqual([
      "volunteer-old",
      "volunteer-recent",
      "volunteer-busy",
      "non-volunteer-empty",
      "non-volunteer-old",
    ]);
  });

  it("falls back to non-volunteers when all volunteers are ineligible or none exist (#589)", () => {
    const candidates = [
      { beneficiaryUserId: "volunteer-capped", agentId: "a", activeClaims: 2, lastOfferedAt: null, volunteered: true },
      { beneficiaryUserId: "volunteer-pending", agentId: "b", activeClaims: 0, lastOfferedAt: null, pendingOffer: true, volunteered: true },
      { beneficiaryUserId: "non-volunteer-avail", agentId: "c", activeClaims: 0, lastOfferedAt: null, volunteered: false },
    ];

    const result = availableOfferCandidates(candidates);
    expect(result.map((c) => c.beneficiaryUserId)).toEqual(["non-volunteer-avail"]);
  });

  it("sweeps expired offers and calls expireOffer for each (#681)", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { sweepExpiredOffers } = await import("@/lib/agent-api/offer");

    vi.spyOn(prisma.projectWorkflow, "findUnique").mockResolvedValue(null);
    const findManySpy = vi.spyOn(prisma.issueClaim, "findMany").mockResolvedValueOnce([
      { id: "claim-1", offeredAt: new Date(Date.now() - 100_000), bug: { projectId: "proj-1" } } as never,
      { id: "claim-2", offeredAt: new Date(Date.now() - 100_000), bug: { projectId: "proj-1" } } as never,
    ]);
    const txMock = {
      issueClaim: {
        findUnique: vi.fn().mockResolvedValue({
          id: "claim-1",
          bugId: "bug-1",
          status: "offered",
          offeredAt: new Date(Date.now() - 100_000),
          releasedAt: null,
          agentId: "agent-1",
          beneficiaryUserId: "user-1",
          bug: { tenantId: "tenant-1", id: "bug-1", title: "Bug 1", projectId: "proj-1", assigneeId: null },
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      bug: {
        findFirst: vi.fn(),
      },
      membership: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      agentEvent: {
        create: vi.fn().mockResolvedValue({ id: "e1" }),
      },
      webhookSubscription: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: "bug-1" }]),
    };
    vi.spyOn(prisma, "$transaction").mockImplementation(async (fn: unknown) =>
      (fn as (tx: unknown) => unknown)(txMock),
    );

    const result = await sweepExpiredOffers("tenant-1");
    expect(findManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "offered",
          releasedAt: null,
          bug: { tenantId: "tenant-1" },
        }),
      }),
    );
    expect(result.expired).toBe(2);
  });

  it("rejects offer acceptance if the issue already has an active claim (#662)", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { acceptOffer } = await import("@/lib/agent-api/offer");
    const { IssueApiError } = await import("@/lib/agent-api/issues");

    const txMock = {
      issueClaim: {
        findUnique: vi.fn().mockResolvedValue({
          id: "claim-1",
          bugId: "bug-1",
          agentId: "agent-1",
          beneficiaryUserId: "user-1",
          status: "offered",
          offeredAt: new Date(),
          releasedAt: null,
          beneficiary: { name: "Agent User" },
          bug: { id: "bug-1", title: "Bug 1", status: "open", assigneeId: null, tenantId: "tenant-1", projectId: "proj-1", voteCount: 5, assignee: null },
        }),
        findFirst: vi.fn().mockResolvedValue({
          id: "claim-active",
          bugId: "bug-1",
          status: "active",
          releasedAt: null,
        }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: "bug-1" }]),
    };
    vi.spyOn(prisma, "$transaction").mockImplementation(async (fn: unknown) =>
      (fn as (tx: unknown) => unknown)(txMock),
    );

    const agent = { agentId: "agent-1", ownerId: "user-1", tenantId: "tenant-1", level: "contributor" as const } as unknown as import("@/lib/agents/require-agent").AgentContext;
    await expect(acceptOffer(agent, "claim-1")).rejects.toThrow(IssueApiError);
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({
      status: 409,
      message: "This issue already has an active claim.",
    });
  });

  it("maps P2002 unique constraint violation to 409 conflict during acceptOffer (#662)", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { Prisma } = await import("@prisma/client");
    const { acceptOffer } = await import("@/lib/agent-api/offer");
    const { IssueApiError } = await import("@/lib/agent-api/issues");

    const p2002Error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.0.0",
    });

    vi.spyOn(prisma, "$transaction").mockRejectedValue(p2002Error);

    const agent = { agentId: "agent-1", ownerId: "user-1", tenantId: "tenant-1", level: "contributor" as const } as unknown as import("@/lib/agents/require-agent").AgentContext;
    await expect(acceptOffer(agent, "claim-1")).rejects.toThrow(IssueApiError);
    await expect(acceptOffer(agent, "claim-1")).rejects.toMatchObject({
      status: 409,
      message: "This issue already has an active claim.",
    });
  });
});


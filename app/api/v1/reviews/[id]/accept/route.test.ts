import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAgent: vi.fn(),
  budget: vi.fn(),
  acceptReviewOffer: vi.fn(),
}));

vi.mock("@/lib/agents/require-agent", async (original) => ({
  ...(await original<typeof import("@/lib/agents/require-agent")>()),
  requireAgent: mocks.requireAgent,
}));

vi.mock("@/lib/agents/rate-budget", () => ({
  consumeAgentBudget: mocks.budget,
  agentBudgetExceededResponse: () =>
    new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 }),
}));

vi.mock("@/lib/agent-api/review-offer", () => ({
  acceptReviewOffer: mocks.acceptReviewOffer,
}));

const db = vi.hoisted(() => ({
  agentAuditEvent: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { POST } from "./route";
import { IssueApiError } from "@/lib/agent-api/issues";

const reviewerAgent = {
  agentId: "r1",
  name: "reviewer-1",
  ownerId: "ro",
  tenantId: "tenant-zedu",
  level: "reviewer" as const,
  burst: false,
  keyId: "k1",
};

const params = { params: Promise.resolve({ id: "offer-1" }) };

function request() {
  return new NextRequest("http://localhost/api/v1/reviews/offer-1/accept", {
    method: "POST",
    headers: {
      authorization: "Bearer test-key",
      "content-type": "application/json",
    },
  });
}

describe("POST /api/v1/reviews/[id]/accept (#597)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgent.mockResolvedValue(reviewerAgent);
    mocks.budget.mockResolvedValue({ allowed: true });
    mocks.acceptReviewOffer.mockResolvedValue({
      offer: { id: "offer-1", status: "accepted" },
    });
    db.agentAuditEvent.create.mockResolvedValue({});
  });

  it("accepts a review offer for a reviewer agent", async () => {
    const res = await POST(request(), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ offer: { id: "offer-1", status: "accepted" } });
    expect(mocks.acceptReviewOffer).toHaveBeenCalledWith(reviewerAgent, "offer-1");
    expect(mocks.budget).toHaveBeenCalledWith({ id: "r1", burst: false, burstUntil: null }, "write");
  });

  it("rejects non-reviewer agents with 403", async () => {
    mocks.requireAgent.mockResolvedValue({
      ...reviewerAgent,
      level: "contributor",
    });

    const res = await POST(request(), params);
    expect(res.status).toBe(403);
    expect(mocks.acceptReviewOffer).not.toHaveBeenCalled();
  });

  it("propagates IssueApiError status codes (e.g. 404, 410)", async () => {
    mocks.acceptReviewOffer.mockRejectedValueOnce(
      new IssueApiError(404, "Review offer not found."),
    );
    const res404 = await POST(request(), params);
    expect(res404.status).toBe(404);
    expect(await res404.json()).toEqual({ error: "Review offer not found." });

    mocks.acceptReviewOffer.mockRejectedValueOnce(
      new IssueApiError(410, "This review offer expired."),
    );
    const res410 = await POST(request(), params);
    expect(res410.status).toBe(410);
    expect(await res410.json()).toEqual({ error: "This review offer expired." });
  });

  it("audits the accept request", async () => {
    await POST(request(), params);
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "reviews.accept",
        }),
      }),
    );
  });
});

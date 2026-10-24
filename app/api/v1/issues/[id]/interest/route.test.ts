import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAgent: vi.fn(),
  budget: vi.fn(),
  registerInterest: vi.fn(),
  withdrawInterest: vi.fn(),
  listVolunteers: vi.fn(),
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

vi.mock("@/lib/agent-api/interest", () => ({
  interestSchema: {
    safeParse: (data: unknown) => ({ success: true, data: (data ?? {}) as { projectId?: string; note?: string } }),
  },
  registerInterest: mocks.registerInterest,
  withdrawInterest: mocks.withdrawInterest,
  listVolunteers: mocks.listVolunteers,
}));

const db = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { GET, POST, DELETE } from "./route";

const contributorAgent = {
  agentId: "c1",
  name: "contributor-1",
  ownerId: "co",
  tenantId: "tenant-zedu",
  level: "contributor" as const,
  burst: false,
  keyId: "k1",
};

const params = { params: Promise.resolve({ id: "bug-1" }) };

function postRequest(body: unknown = {}, search = "?projectId=proj-1") {
  return new NextRequest(`http://localhost/api/v1/issues/bug-1/interest${search}`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-key",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function deleteRequest(search = "?projectId=proj-1") {
  return new NextRequest(`http://localhost/api/v1/issues/bug-1/interest${search}`, {
    method: "DELETE",
    headers: {
      authorization: "Bearer test-key",
    },
  });
}

function getRequest(search = "?projectId=proj-1") {
  return new NextRequest(`http://localhost/api/v1/issues/bug-1/interest${search}`, {
    method: "GET",
    headers: {
      authorization: "Bearer test-key",
    },
  });
}

describe("Issue Interest Routes (#589)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgent.mockResolvedValue(contributorAgent);
    mocks.budget.mockResolvedValue({ allowed: true });
    db.project.findFirst.mockResolvedValue({ id: "proj-1" });
    db.agentAuditEvent.create.mockResolvedValue({});
  });

  describe("POST /api/v1/issues/[id]/interest", () => {
    it("registers interest and returns 201 when newly created", async () => {
      mocks.registerInterest.mockResolvedValue({
        created: true,
        interest: {
          id: "int-1",
          bugId: "bug-1",
          agentId: "c1",
          beneficiaryUserId: "co",
          note: "volunteering",
          createdAt: new Date("2026-10-20T12:00:00.000Z"),
        },
      });

      const res = await POST(postRequest({ note: "volunteering" }), params);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.interest.id).toBe("int-1");
      expect(mocks.registerInterest).toHaveBeenCalledWith(contributorAgent, "proj-1", "bug-1", "volunteering");
      expect(mocks.budget).toHaveBeenCalledWith({ id: "c1", burst: false, burstUntil: null }, "write");
      expect(db.agentAuditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: "issues.interest" }),
        }),
      );
    });

    it("returns 200 when interest was already registered (idempotent)", async () => {
      mocks.registerInterest.mockResolvedValue({
        created: false,
        interest: {
          id: "int-1",
          bugId: "bug-1",
          agentId: "c1",
          beneficiaryUserId: "co",
          note: "volunteering",
          createdAt: new Date("2026-10-20T12:00:00.000Z"),
        },
      });

      const res = await POST(postRequest({ note: "volunteering" }), params);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.interest.id).toBe("int-1");
    });

    it("rejects non-contributor agents with 403", async () => {
      mocks.requireAgent.mockResolvedValue({
        ...contributorAgent,
        level: "observer",
      });

      const res = await POST(postRequest(), params);
      expect(res.status).toBe(403);
      expect(mocks.registerInterest).not.toHaveBeenCalled();
    });

    it("requires projectId", async () => {
      const res = await POST(postRequest({}, ""), params);
      expect(res.status).toBe(400);
      expect(mocks.registerInterest).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/v1/issues/[id]/interest", () => {
    it("withdraws registered interest", async () => {
      mocks.withdrawInterest.mockResolvedValue({
        withdrawn: true,
        interest: { id: "int-1" },
      });

      const res = await DELETE(deleteRequest(), params);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ interest_id: "int-1", status: "withdrawn" });
      expect(mocks.withdrawInterest).toHaveBeenCalledWith(contributorAgent, "proj-1", "bug-1");
    });
  });

  describe("GET /api/v1/issues/[id]/interest", () => {
    it("lists registered volunteers", async () => {
      const now = new Date("2026-10-20T12:00:00.000Z");
      mocks.listVolunteers.mockResolvedValue([
        {
          id: "int-1",
          agentId: "c1",
          agent: { name: "Agent 1" },
          beneficiaryUserId: "co",
          note: "test note",
          createdAt: now,
        },
      ]);

      const res = await GET(getRequest(), params);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.volunteers).toHaveLength(1);
      expect(data.volunteers[0]).toEqual({
        id: "int-1",
        agent_id: "c1",
        agent_name: "Agent 1",
        beneficiary_user_id: "co",
        note: "test note",
        created_at: now.toISOString(),
      });
    });
  });
});

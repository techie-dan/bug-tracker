import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
  agentQuestion: { create: vi.fn(), findFirst: vi.fn() },
  bug: { findFirst: vi.fn() },
  agentEvent: { create: vi.fn() },
  webhookSubscription: { findMany: vi.fn() },
  webhookDelivery: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));

const budget = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/notify", () => ({ notifyLater: vi.fn() }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({
  ...(await original<typeof import("@/lib/agents/rate-budget")>()),
  consumeAgentBudget: budget,
}));

import { POST as createEscalation } from "./route";
import { GET as readEscalation } from "./[id]/route";

const key = {
  id: "key-a",
  revokedAt: null,
  projectId: null,
  agent: {
    id: "agent-a",
    name: "Agent A",
    ownerUserId: "owner-a",
    tenantId: "tenant-a",
    level: "contributor",
    burst: false,
    revokedAt: null,
    owner: { memberships: [{ tenantId: "tenant-a" }] },
  },
};

function postRequest(body: unknown, keyHeader = "Bearer ziki_test") {
  return new NextRequest("http://localhost/api/v1/escalations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(keyHeader ? { authorization: keyHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

function getRequest(path = "http://localhost/api/v1/escalations/esc-1", keyHeader = "Bearer ziki_test") {
  return new NextRequest(path, {
    method: "GET",
    headers: keyHeader ? { authorization: keyHeader } : {},
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.agentApiKey.findUnique.mockResolvedValue(key);
  budget.mockResolvedValue({ allowed: true });
  db.agentQuestion.create.mockResolvedValue({
    id: "esc-1",
    bugId: null,
    body: "[blocker] I am stuck on missing keys",
    createdAt: new Date(),
  });
  db.agentQuestion.findFirst.mockResolvedValue(null);
  db.agentAuditEvent.create.mockResolvedValue({});
  db.agentEvent.create.mockResolvedValue({ id: "e1" });
  db.webhookSubscription.findMany.mockResolvedValue([]);
});

describe("POST /api/v1/escalations & GET /api/v1/escalations/[id] (#749)", () => {
  it("submits a typed escalation and returns status open", async () => {
    const res = await createEscalation(
      postRequest({
        body: "I am stuck on missing keys",
        type: "blocker",
      }),
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.escalation).toMatchObject({
      id: "esc-1",
      body: "I am stuck on missing keys",
      type: "blocker",
      status: "open",
    });
    expect(db.agentQuestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: "[blocker] I am stuck on missing keys",
          agentId: "agent-a",
          ownerUserId: "owner-a",
        }),
      }),
    );
  });

  it("infers classification when type is not provided", async () => {
    db.agentQuestion.create.mockResolvedValue({
      id: "esc-2",
      bugId: null,
      body: "Need permission to start work on this",
      createdAt: new Date(),
    });

    const res = await createEscalation(
      postRequest({
        body: "Need permission to start work on this",
      }),
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.escalation.type).toBe("work_authorization");
  });

  it("rejects invalid type or missing body with 400", async () => {
    const res = await createEscalation(
      postRequest({
        body: "hi", // too short min 3
        type: "invalid_type",
      }),
    );

    expect(res.status).toBe(400);
  });

  it("reads an open escalation by ID with status open", async () => {
    db.agentQuestion.findFirst.mockResolvedValue({
      id: "esc-1",
      agentId: "agent-a",
      body: "[blocker] Stuck on API key",
      answer: null,
      answeredAt: null,
      bugId: null,
      createdAt: new Date(),
    });

    const res = await readEscalation(getRequest(), { params: Promise.resolve({ id: "esc-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.escalation).toMatchObject({
      id: "esc-1",
      body: "Stuck on API key",
      type: "blocker",
      status: "open",
      resolution: null,
      resolvedAt: null,
    });
  });

  it("reads a resolved escalation with resolution and resolved status", async () => {
    const answeredAt = new Date();
    db.agentQuestion.findFirst.mockResolvedValue({
      id: "esc-1",
      agentId: "agent-a",
      body: "[work_authorization] Can I start work?",
      answer: "Authorized. Proceed.",
      answeredAt,
      bugId: null,
      createdAt: new Date(),
    });

    const res = await readEscalation(getRequest(), { params: Promise.resolve({ id: "esc-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.escalation).toMatchObject({
      id: "esc-1",
      body: "Can I start work?",
      type: "work_authorization",
      status: "resolved",
      resolution: "Authorized. Proceed.",
      resolvedAt: answeredAt.toISOString(),
    });
  });

  it("returns 404 when escalation not found", async () => {
    db.agentQuestion.findFirst.mockResolvedValue(null);

    const res = await readEscalation(getRequest(), { params: Promise.resolve({ id: "esc-999" }) });
    expect(res.status).toBe(404);
  });
});

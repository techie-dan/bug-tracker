import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAgent: vi.fn(),
  budget: vi.fn(),
  createGoal: vi.fn(),
  listGoals: vi.fn(),
  readGoal: vi.fn(),
  splitGoalPool: vi.fn(),
  updateGoalStatus: vi.fn(),
}));

const db = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
  goal: { findFirst: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
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

vi.mock("@/lib/agent-api/events", () => ({ publish: vi.fn() }));
vi.mock("@/lib/goals/service", () => ({
  createGoal: mocks.createGoal,
  listGoals: mocks.listGoals,
  readGoal: mocks.readGoal,
  splitGoalPool: mocks.splitGoalPool,
  updateGoalStatus: mocks.updateGoalStatus,
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { GET as listGET, POST as createPOST } from "./route";
import { GET as readGET, PATCH as patchPATCH } from "./[id]/route";
import { GET as allocationsGET, POST as splitPOST } from "./[id]/allocations/route";
import { IssueApiError } from "@/lib/agent-api/issues";

const agent = {
  agentId: "agent1",
  name: "Ada's Claude",
  ownerId: "user1",
  tenantId: "tenant1",
  level: "contributor" as const,
  burst: false,
  keyId: "k1",
  projectId: null,
};

function request(url: string, body?: unknown, method = "POST") {
  return new NextRequest(url, {
    method: body === undefined ? method : method,
    headers: { authorization: "Bearer test-key", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const budgetSummary = { budgetPool: 1000, allocated: 400, remaining: 600, utilizationPercent: 40, splitStatus: "partially-split" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAgent.mockResolvedValue(agent);
  mocks.budget.mockResolvedValue({ allowed: true });
  db.project.findFirst.mockResolvedValue({ id: "project1" });
  db.agentAuditEvent.create.mockResolvedValue({});
  mocks.createGoal.mockResolvedValue({ id: "goal1", budgetPool: 1000, allocated: 0 });
  mocks.listGoals.mockResolvedValue([]);
  mocks.readGoal.mockResolvedValue({ goal: { id: "goal1", budget: budgetSummary }, allocations: [] });
  mocks.splitGoalPool.mockResolvedValue({ goal: { id: "goal1", allocated: 400, budget: budgetSummary }, allocations: [] });
  mocks.updateGoalStatus.mockResolvedValue({ id: "goal1", status: "completed", budget: budgetSummary });
});

describe("POST /api/v1/goals (#616)", () => {
  it("creates a goal with 201", async () => {
    const res = await createPOST(
      request("http://localhost/api/v1/goals?projectId=project1", {
        title: "Ship the auth audit",
        budgetPool: 1000,
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ goal: { id: "goal1", budgetPool: 1000, allocated: 0 } });
  });

  it("400s on an invalid body", async () => {
    const res = await createPOST(request("http://localhost/api/v1/goals?projectId=project1", { title: "x" }));
    expect(res.status).toBe(400);
  });

  it("400s without a projectId", async () => {
    const res = await createPOST(request("http://localhost/api/v1/goals", { title: "Ship the auth audit", budgetPool: 1 }));
    expect(res.status).toBe(400);
  });

  it("403s for an observer", async () => {
    mocks.requireAgent.mockResolvedValue({ ...agent, level: "observer" });
    const res = await createPOST(
      request("http://localhost/api/v1/goals?projectId=project1", { title: "Ship the auth audit", budgetPool: 1 }),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/goals (#616)", () => {
  it("lists the project's goals", async () => {
    const res = await listGET(request("http://localhost/api/v1/goals?projectId=project1", undefined, "GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ goals: [] });
  });

  it("404s a project outside the tenant", async () => {
    db.project.findFirst.mockResolvedValue(null);
    const res = await listGET(request("http://localhost/api/v1/goals?projectId=other", undefined, "GET"));
    expect(res.status).toBe(404);
  });

  it("401s without a key", async () => {
    mocks.requireAgent.mockRejectedValueOnce(new (await import("@/lib/agents/require-agent")).AgentAuthError("missing_key"));
    const res = await listGET(request("http://localhost/api/v1/goals?projectId=project1", undefined, "GET"));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/goals/[id] (#616)", () => {
  it("returns the goal, its budget, and allocations", async () => {
    const res = await readGET(request("http://localhost/api/v1/goals/goal1?projectId=project1", undefined, "GET"), {
      params: Promise.resolve({ id: "goal1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ goal: { id: "goal1" }, budget: budgetSummary, allocations: [] });
  });
});

describe("PATCH /api/v1/goals/[id] (#616)", () => {
  it("updates the status", async () => {
    const res = await patchPATCH(request("http://localhost/api/v1/goals/goal1?projectId=project1", { status: "completed" }, "PATCH"), {
      params: Promise.resolve({ id: "goal1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ goal: { status: "completed" }, budget: budgetSummary });
  });

  it("400s an unknown status", async () => {
    const res = await patchPATCH(request("http://localhost/api/v1/goals/goal1?projectId=project1", { status: "archived" }, "PATCH"), {
      params: Promise.resolve({ id: "goal1" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/goals/[id]/allocations (#616)", () => {
  it("executes a split with 201", async () => {
    const res = await splitPOST(
      request("http://localhost/api/v1/goals/goal1/allocations?projectId=project1", {
        method: "proportional",
        amount: 600,
        targets: [{ targetType: "issue", targetBugId: "bug1", weight: 1 }],
      }),
      { params: Promise.resolve({ id: "goal1" }) },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ goal: { id: "goal1" }, budget: budgetSummary, allocations: [] });
    expect(mocks.splitGoalPool).toHaveBeenCalledWith(
      agent,
      "goal1",
      expect.objectContaining({ method: "proportional", projectId: "project1" }),
    );
  });

  it("400s an invalid split body", async () => {
    const res = await splitPOST(
      request("http://localhost/api/v1/goals/goal1/allocations?projectId=project1", { method: "manual", targets: [] }),
      { params: Promise.resolve({ id: "goal1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("propagates an over-allocation as 409", async () => {
    mocks.splitGoalPool.mockRejectedValueOnce(new IssueApiError(409, "too much"));
    const res = await splitPOST(
      request("http://localhost/api/v1/goals/goal1/allocations?projectId=project1", {
        method: "even",
        amount: 100,
        targets: [{ targetType: "issue", targetBugId: "bug1" }],
      }),
      { params: Promise.resolve({ id: "goal1" }) },
    );
    expect(res.status).toBe(409);
  });

  it("403s a split for an observer", async () => {
    mocks.requireAgent.mockResolvedValue({ ...agent, level: "observer" });
    const res = await splitPOST(
      request("http://localhost/api/v1/goals/goal1/allocations?projectId=project1", {
        method: "even",
        amount: 100,
        targets: [{ targetType: "issue", targetBugId: "bug1" }],
      }),
      { params: Promise.resolve({ id: "goal1" }) },
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/goals/[id]/allocations (#616)", () => {
  it("lists the goal's live allocations", async () => {
    mocks.readGoal.mockResolvedValue({ goal: { id: "goal1" }, allocations: [{ id: "ga1", amount: 400 }] });
    const res = await allocationsGET(
      request("http://localhost/api/v1/goals/goal1/allocations?projectId=project1", undefined, "GET"),
      { params: Promise.resolve({ id: "goal1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allocations: [{ id: "ga1", amount: 400 }] });
  });
});

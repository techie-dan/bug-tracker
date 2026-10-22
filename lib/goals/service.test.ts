import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const mock = {
    project: { findFirst: vi.fn() },
    goal: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    goalAllocation: { findMany: vi.fn(), createMany: vi.fn() },
    bug: { findMany: vi.fn() },
    agent: { findMany: vi.fn() },
    agentAuditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation((fn: (tx: typeof mock) => unknown) => fn(mock));
  return mock;
});

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/events", () => ({ publish: vi.fn(async () => ({ id: "evt" })) }));

import { publish } from "@/lib/agent-api/events";
import { createGoal, listGoals, readGoal, splitGoalPool, updateGoalStatus, withBudget } from "./service";
import { IssueApiError } from "@/lib/agent-api/issues";

const agent = {
  agentId: "agent1",
  name: "Ada's Claude",
  ownerId: "ada",
  tenantId: "tenant1",
  level: "contributor" as const,
  burst: false,
  keyId: "key1",
  projectId: null,
};

const goalRow = {
  id: "goal1",
  tenantId: "tenant1",
  projectId: "project1",
  createdById: "ada",
  title: "Ship the auth audit",
  description: null,
  budgetPool: 1000,
  allocated: 0,
  status: "active" as const,
  createdAt: new Date("2026-10-20T10:00:00Z"),
  updatedAt: new Date("2026-10-20T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  db.project.findFirst.mockResolvedValue({ id: "project1", tenantId: "tenant1" });
  db.goal.findFirst.mockResolvedValue(goalRow);
  db.goal.create.mockResolvedValue(goalRow);
  db.goal.findMany.mockResolvedValue([goalRow]);
  db.goal.update.mockResolvedValue({ ...goalRow, status: "completed" });
  db.goal.updateMany.mockResolvedValue({ count: 1 });
  db.goal.findUniqueOrThrow.mockResolvedValue({ ...goalRow, allocated: 600 });
  db.goalAllocation.findMany.mockResolvedValue([]);
  db.goalAllocation.createMany.mockResolvedValue({ count: 0 });
  db.bug.findMany.mockResolvedValue([{ id: "bug1" }]);
  db.agent.findMany.mockResolvedValue([{ id: "agent1" }]);
  db.agentAuditEvent.create.mockResolvedValue({});
});

describe("createGoal (#616)", () => {
  it("creates a goal in the agent's project with an unfunded pool", async () => {
    const goal = await createGoal(agent, { title: "Ship the auth audit", budgetPool: 1000 });
    expect(goal.id).toBe("goal1");
    expect(db.goal.create.mock.calls[0][0].data).toMatchObject({
      tenantId: "tenant1",
      projectId: "project1",
      createdById: "ada",
      budgetPool: 1000,
    });
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "goal.created" }));
  });

  it("404s when the project is not in the tenant", async () => {
    db.project.findFirst.mockResolvedValue(null);
    await expect(createGoal(agent, { title: "Ship it", budgetPool: 1 })).rejects.toMatchObject({ status: 404 });
  });
});

describe("listGoals (#616)", () => {
  it("attaches a budget summary to every goal", async () => {
    const goals = await listGoals("tenant1", "project1");
    expect(goals[0]).toMatchObject({ id: "goal1", budget: { remaining: 1000, splitStatus: "unfunded" } });
  });
});

describe("readGoal (#616)", () => {
  it("returns the goal, its budget, and live allocations", async () => {
    db.goalAllocation.findMany.mockResolvedValue([{ id: "ga1", amount: 400 }]);
    const { goal, allocations } = await readGoal(agent, "goal1");
    expect(goal.budget).toMatchObject({ budgetPool: 1000, remaining: 1000 });
    expect(allocations).toHaveLength(1);
  });

  it("404s a goal outside the tenant", async () => {
    db.goal.findFirst.mockResolvedValue(null);
    await expect(readGoal(agent, "goal1")).rejects.toBeInstanceOf(IssueApiError);
  });
});

describe("splitGoalPool (#616)", () => {
  it("splits a pool proportionally and bumps allocated inside the transaction", async () => {
    const { goal, allocations } = await splitGoalPool(agent, "goal1", {
      method: "proportional",
      amount: 600,
      sourceKey: "audit-split",
      targets: [
        { targetType: "issue", targetBugId: "bug1", weight: 3 },
        { targetType: "agent", label: "Audit report", weight: 1 },
      ],
    });

    // 600 split 3:1 -> 450 / 150.
    expect(db.goalAllocation.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ amount: 450, sourceKey: "audit-split:0", targetType: "issue" }),
      expect.objectContaining({ amount: 150, sourceKey: "audit-split:1", targetType: "agent" }),
    ]);
    expect(db.goal.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "goal1", status: "active", allocated: { lte: 400 } },
      data: { allocated: { increment: 600 } },
    });
    expect(goal.allocated).toBe(600);
    expect(allocations).toEqual([]);
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "goal.split" }));
  });

  it("defaults the split amount to everything still unallocated", async () => {
    db.goal.findFirst.mockResolvedValue({ ...goalRow, allocated: 400 });
    await splitGoalPool(agent, "goal1", {
      method: "even",
      targets: [{ targetType: "issue", targetBugId: "bug1" }, { targetType: "agent", label: "Chats" }],
    });
    expect(db.goal.updateMany.mock.calls[0][0].data).toEqual({ allocated: { increment: 600 } });
    expect(db.goalAllocation.createMany.mock.calls[0][0].data.map((row: { amount: number }) => row.amount)).toEqual([300, 300]);
  });

  it("drops zero-amount allocations but keeps the total", async () => {
    await splitGoalPool(agent, "goal1", {
      method: "proportional",
      amount: 2,
      targets: [
        { targetType: "issue", targetBugId: "bug1", weight: 3 },
        { targetType: "agent", label: "Audit report", weight: 1 },
      ],
    });
    // 2 split 3:1 -> 2 / 0, so only one row is written and it sums to 2.
    const rows = db.goalAllocation.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(2);
    expect(db.goal.updateMany.mock.calls[0][0].data).toEqual({ allocated: { increment: 2 } });
  });

  it("409s when the split would over-allocate the pool", async () => {
    db.goal.findFirst.mockResolvedValue({ ...goalRow, allocated: 800 });
    await expect(
      splitGoalPool(agent, "goal1", {
        method: "even",
        amount: 500,
        targets: [{ targetType: "issue", targetBugId: "bug1" }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.goal.updateMany).not.toHaveBeenCalled();
    expect(db.goalAllocation.createMany).not.toHaveBeenCalled();
  });

  it("409s an empty pool asked for a default-amount split", async () => {
    db.goal.findFirst.mockResolvedValue({ ...goalRow, budgetPool: 0, allocated: 0 });
    await expect(
      splitGoalPool(agent, "goal1", {
        method: "even",
        targets: [{ targetType: "issue", targetBugId: "bug1" }],
      }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("empty") });
  });

  it("409s when the guard update finds the pool already taken (concurrent split)", async () => {
    db.goal.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      splitGoalPool(agent, "goal1", {
        method: "manual",
        targets: [{ targetType: "issue", targetBugId: "bug1", amount: 100 }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.goalAllocation.createMany).not.toHaveBeenCalled();
  });

  it("409s a reused sourceKey before any credit moves", async () => {
    db.goalAllocation.findMany.mockResolvedValue([{ sourceKey: "dup:0" }]);
    await expect(
      splitGoalPool(agent, "goal1", {
        method: "even",
        amount: 100,
        sourceKey: "dup",
        targets: [{ targetType: "issue", targetBugId: "bug1" }],
      }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("already applied") });
    expect(db.goal.updateMany).not.toHaveBeenCalled();
  });

  it("409s a split on a goal that is not active", async () => {
    db.goal.findFirst.mockResolvedValue({ ...goalRow, status: "completed" });
    await expect(
      splitGoalPool(agent, "goal1", {
        method: "even",
        amount: 100,
        targets: [{ targetType: "issue", targetBugId: "bug1" }],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("404s an unknown issue target", async () => {
    db.bug.findMany.mockResolvedValue([]);
    await expect(
      splitGoalPool(agent, "goal1", {
        method: "even",
        amount: 100,
        targets: [{ targetType: "issue", targetBugId: "ghost" }],
      }),
    ).rejects.toMatchObject({ status: 404, message: expect.stringContaining("ghost") });
  });

  it("400s a goal funding itself", async () => {
    await expect(
      splitGoalPool(agent, "goal1", {
        method: "even",
        amount: 100,
        targets: [{ targetType: "goal", targetGoalId: "goal1" }],
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("itself") });
  });

  it("refuses milestone shares that do not total 100 at the schema boundary", async () => {
    await expect(
      splitGoalPool(agent, "goal1", {
        method: "milestone",
        amount: 100,
        targets: [{ targetType: "issue", targetBugId: "bug1", weight: 40 }],
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(db.goal.updateMany).not.toHaveBeenCalled();
  });
});

describe("updateGoalStatus (#616)", () => {
  it("moves the goal and publishes an update", async () => {
    const goal = await updateGoalStatus(agent, "goal1", { status: "completed" });
    expect(goal.status).toBe("completed");
    expect(publish).toHaveBeenCalledWith(db, expect.objectContaining({ type: "goal.updated" }));
  });
});

describe("withBudget (#616)", () => {
  it("adds the computed budget without dropping the row's fields", () => {
    const view = withBudget({ budgetPool: 100, allocated: 25 });
    expect(view).toMatchObject({ budgetPool: 100, allocated: 25, budget: { remaining: 75, utilizationPercent: 25 } });
  });
});

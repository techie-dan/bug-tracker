// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ goal: { findMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { GoalBudgetSection } from "./goal-budgets";

beforeEach(() => {
  vi.clearAllMocks();
  db.goal.findMany.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("GoalBudgetSection (#616)", () => {
  it("renders nothing when the project has no goals", async () => {
    const { container } = render(
      await GoalBudgetSection({ tenantId: "tenant1", projectId: "project1" }),
    );
    expect(container.querySelector("section")).toBeNull();
  });

  it("shows each goal's pool, split status, and utilization", async () => {
    db.goal.findMany.mockResolvedValue([
      {
        id: "goal1",
        title: "Ship the auth audit",
        status: "active",
        budgetPool: 1000,
        allocated: 400,
        allocations: [],
      },
    ]);
    const { getByText, getAllByTestId } = render(
      await GoalBudgetSection({ tenantId: "tenant1", projectId: "project1" }),
    );
    expect(getByText("Ship the auth audit")).toBeTruthy();
    expect(getByText("Partially split")).toBeTruthy();
    expect(getByText(/400 of 1000 credits split/)).toBeTruthy();
    expect(getAllByTestId("goal-budget-row")).toHaveLength(1);
  });

  it("sums the slices reserved for the current issue", async () => {
    db.goal.findMany.mockResolvedValue([
      {
        id: "goal1",
        title: "Ship the auth audit",
        status: "active",
        budgetPool: 1000,
        allocated: 400,
        allocations: [{ amount: 250 }, { amount: 150 }],
      },
    ]);
    const { getByText } = render(
      await GoalBudgetSection({ tenantId: "tenant1", projectId: "project1", bugId: "bug1" }),
    );
    expect(getByText(/400 credits reserved for this issue/)).toBeTruthy();
    expect(db.goal.findMany.mock.calls[0][0].select.allocations.where).toMatchObject({
      releasedAt: null,
      targetBugId: "bug1",
    });
  });

  it("marks a fully split goal and an empty pool distinctly", async () => {
    db.goal.findMany.mockResolvedValue([
      { id: "g1", title: "Full goal", status: "completed", budgetPool: 100, allocated: 100, allocations: [] },
      { id: "g2", title: "Empty goal", status: "active", budgetPool: 0, allocated: 0, allocations: [] },
    ]);
    const { getByText } = render(await GoalBudgetSection({ tenantId: "tenant1", projectId: "project1" }));
    expect(getByText("Full goal")).toBeTruthy();
    expect(getByText("Empty goal")).toBeTruthy();
    // The split-status badge reads "Fully split" while the empty pool reads "No budget".
    expect(getByText("Fully split")).toBeTruthy();
    expect(getByText("No budget")).toBeTruthy();
  });
});

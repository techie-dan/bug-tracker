import { describe, expect, it } from "vitest";
import {
  PoolBudgetError,
  assertWithinPool,
  describeBudget,
  remainingPool,
  splitEvenly,
  splitMilestones,
  splitProportional,
  type PoolErrorCode,
} from "./pool-split";

/** Runs `fn` and returns the `PoolBudgetError` code it threw. */
function refusal(fn: () => unknown): PoolErrorCode {
  try {
    fn();
  } catch (error) {
    if (error instanceof PoolBudgetError) return error.code;
    throw error;
  }
  throw new Error("expected a PoolBudgetError");
}

describe("remainingPool / assertWithinPool (#616)", () => {
  it("computes what is left of the pool", () => {
    expect(remainingPool(1000, 0)).toBe(1000);
    expect(remainingPool(1000, 400)).toBe(600);
    expect(remainingPool(1000, 1000)).toBe(0);
  });

  it("reports a negative remainder when over-allocated", () => {
    expect(remainingPool(100, 150)).toBe(-50);
  });

  it("refuses a negative pool or negative allocation", () => {
    expect(refusal(() => remainingPool(-1, 0))).toBe("negative_pool");
    expect(refusal(() => remainingPool(10, -1))).toBe("negative_pool");
    expect(refusal(() => remainingPool(1.5, 0))).toBe("negative_pool");
  });

  it("accepts a split that exactly fills the pool", () => {
    expect(assertWithinPool(1000, 0, 1000)).toBe(1000);
    expect(assertWithinPool(1000, 600, 400)).toBe(400);
  });

  it("refuses an empty pool asked for credits", () => {
    expect(refusal(() => assertWithinPool(0, 0, 1))).toBe("empty_pool");
  });

  it("refuses over-allocation and reports what is left", () => {
    expect(refusal(() => assertWithinPool(1000, 600, 500))).toBe("over_allocated");
    // A zero-credit ask is never an over-allocation, even with nothing left.
    expect(assertWithinPool(1000, 1000, 0)).toBe(0);
  });
});

describe("splitProportional (#616)", () => {
  it("splits by weight", () => {
    expect(splitProportional(1000, [1, 1, 2])).toEqual([250, 250, 500]);
  });

  it("distributes rounding remainders by largest fraction, in index order", () => {
    // 100/3 -> 33.33 each: one credit each to the first two, none to the last.
    expect(splitProportional(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
  });

  it("sums to exactly the requested amount across awkward ratios", () => {
    for (const amount of [1, 2, 7, 13, 99, 1000, 999_983]) {
      const pieces = splitProportional(amount, [3, 5, 9, 11]);
      expect(pieces.reduce((sum, piece) => sum + piece, 0)).toBe(amount);
    }
  });

  it("gives a zero weight nothing and keeps the total", () => {
    const pieces = splitProportional(101, [0, 1, 1]);
    expect(pieces[0]).toBe(0);
    expect(pieces.reduce((sum, piece) => sum + piece, 0)).toBe(101);
  });

  it("handles a zero amount", () => {
    expect(splitProportional(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it("handles a single target", () => {
    expect(splitProportional(77, [42])).toEqual([77]);
  });

  it("refuses all-zero weights, empty targets, negative weights, and bad amounts", () => {
    expect(refusal(() => splitProportional(10, [0, 0]))).toBe("bad_weights");
    expect(refusal(() => splitProportional(10, []))).toBe("bad_weights");
    expect(refusal(() => splitProportional(10, [1, -1]))).toBe("bad_weights");
    expect(refusal(() => splitProportional(-5, [1]))).toBe("bad_amount");
    expect(refusal(() => splitProportional(1.5, [1]))).toBe("bad_amount");
  });
});

describe("splitMilestones (#616)", () => {
  it("splits by percentage shares that total 100", () => {
    expect(splitMilestones(1000, [50, 25, 25])).toEqual([500, 250, 250]);
  });

  it("spreads rounding remainders without losing a credit", () => {
    const pieces = splitMilestones(100, [33, 33, 34]);
    expect(pieces).toEqual([33, 33, 34]);
    expect(splitMilestones(101, [50, 50])).toEqual([51, 50]);
  });

  it("refuses shares that do not total exactly 100", () => {
    expect(refusal(() => splitMilestones(100, [50, 40]))).toBe("bad_shares");
    expect(refusal(() => splitMilestones(100, [60, 50]))).toBe("bad_shares");
    expect(refusal(() => splitMilestones(100, []))).toBe("bad_shares");
    expect(refusal(() => splitMilestones(100, [50, 50.5]))).toBe("bad_shares");
  });

  it("handles a single 100% milestone", () => {
    expect(splitMilestones(250, [100])).toEqual([250]);
  });
});

describe("splitEvenly (#616)", () => {
  it("gives leftovers to the earliest targets", () => {
    expect(splitEvenly(10, 4)).toEqual([3, 3, 2, 2]);
  });

  it("handles a zero amount and a single target", () => {
    expect(splitEvenly(0, 3)).toEqual([0, 0, 0]);
    expect(splitEvenly(5, 1)).toEqual([5]);
  });

  it("refuses a non-positive or fractional target count", () => {
    expect(refusal(() => splitEvenly(10, 0))).toBe("bad_weights");
    expect(refusal(() => splitEvenly(10, -1))).toBe("bad_weights");
    expect(refusal(() => splitEvenly(10, 2.5))).toBe("bad_weights");
  });
});

describe("describeBudget (#616)", () => {
  it("reports an empty pool", () => {
    expect(describeBudget(0, 0)).toEqual({
      budgetPool: 0,
      allocated: 0,
      remaining: 0,
      utilizationPercent: 0,
      splitStatus: "no-budget",
    });
  });

  it("reports an unfunded pool", () => {
    expect(describeBudget(1000, 0)).toMatchObject({ remaining: 1000, utilizationPercent: 0, splitStatus: "unfunded" });
  });

  it("reports a partially split pool", () => {
    expect(describeBudget(1000, 250)).toMatchObject({
      remaining: 750,
      utilizationPercent: 25,
      splitStatus: "partially-split",
    });
  });

  it("reports a fully split pool", () => {
    expect(describeBudget(1000, 1000)).toMatchObject({ remaining: 0, utilizationPercent: 100, splitStatus: "fully-split" });
  });

  it("clamps a defensive negative or over-allocated input", () => {
    expect(describeBudget(-5, -1)).toBeDefined();
    const over = describeBudget(100, 250);
    expect(over.remaining).toBe(0);
    expect(over.utilizationPercent).toBe(100);
    expect(over.splitStatus).toBe("fully-split");
  });
});

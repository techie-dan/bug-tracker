/**
 * Pool-splitting arithmetic for goal budgets (#616).
 *
 * Pure functions only — no Prisma, no I/O — so every boundary case (an empty
 * pool, rounding remainders, an over-allocating split) is unit-testable in
 * isolation. Amounts are integer credits and the math never relies on float
 * rounding: `largestRemainder` keeps every quotient as an integer division
 * with an integer remainder, so `splitProportional` and friends always return
 * pieces that sum to exactly the requested amount.
 */

/** The largest pool a goal may declare, in credits. Mirrored in Zod (`lib/validations/goal.ts`). */
export const MAX_POOL_CREDITS = 1_000_000_000;

/** The most targets one split may carve the pool across. Mirrored in Zod. */
export const MAX_SPLIT_TARGETS = 50;

/** How a split computes each target's slice of the pool (#616). */
export type SplitMethod = "manual" | "proportional" | "milestone" | "even";

/** Why a split was refused, in machine-readable form. */
export type PoolErrorCode =
  | "negative_pool"
  | "over_allocated"
  | "empty_pool"
  | "bad_amount"
  | "bad_weights"
  | "bad_shares";

/** A refused pool operation. Callers map `code` to an HTTP status. */
export class PoolBudgetError extends Error {
  constructor(
    /** Machine-readable refusal reason (see {@link PoolErrorCode}). */
    public code: PoolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PoolBudgetError";
  }
}

/** How full a goal's pool already is, for the API and the UI. */
export type GoalSplitStatus = "no-budget" | "unfunded" | "partially-split" | "fully-split";

/** A goal's pool projected into displayable, already-clamped numbers. */
export type GoalBudgetSummary = {
  /** Total credits the goal may split. */
  budgetPool: number;
  /** Credits already carved out by live allocations. */
  allocated: number;
  /** Credits still splittable; never negative. */
  remaining: number;
  /** 0–100, rounded; 0 when the pool is empty. */
  utilizationPercent: number;
  /** Coarse split state for badges. */
  splitStatus: GoalSplitStatus;
};

/**
 * Asserts a value is a whole, non-negative credit amount.
 *
 * @param value - Candidate amount.
 * @param what - Phrase used in the error message, e.g. `"Split amount"`.
 * @throws {PoolBudgetError} `bad_amount` when `value` is negative or not an integer.
 */
function assertCredits(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new PoolBudgetError("bad_amount", `${what} must be a whole number of credits, got ${value}.`);
  }
}

/**
 * Splits `amount` across `numerators` by largest-remainder rounding, so the
 * pieces always sum to exactly `amount`.
 *
 * Piece `i` starts at `floor(amount * numerators[i] / denominator)`; the
 * leftover credits go one at a time to the largest fractional parts, ties
 * resolved by the earlier index. Quotients stay integer, so no float drift can
 * steal or invent a credit.
 *
 * @param amount - Total credits to distribute; 0 returns all zeros.
 * @param numerators - Non-negative integer weights/shares, one per piece.
 * @param denominator - The total the numerators are parts of (their sum for
 *   proportional splits, 100 for milestone shares, the count for even splits).
 * @returns One integer amount per numerator, summing to exactly `amount`.
 * @throws {PoolBudgetError} `bad_amount` for a negative/non-integer amount,
 *   `bad_weights` when the denominator is not positive.
 */
function largestRemainder(amount: number, numerators: readonly number[], denominator: number): number[] {
  assertCredits(amount, "Split amount");
  if (!Number.isInteger(denominator) || denominator <= 0) {
    throw new PoolBudgetError("bad_weights", `Split weights must total a positive number, got ${denominator}.`);
  }
  const bases = numerators.map((n) => Math.floor((amount * n) / denominator));
  const remainders = numerators.map((n) => (amount * n) % denominator);
  let leftover = amount - bases.reduce((sum, base) => sum + base, 0);
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (leftover <= 0) break;
    bases[index] = (bases[index] ?? 0) + 1;
    leftover -= 1;
  }
  return bases;
}

/**
 * The credits a goal can still split.
 *
 * @param budgetPool - The goal's total pool; must be a non-negative integer.
 * @param allocated - Credits already allocated; must be a non-negative integer.
 * @returns `budgetPool - allocated`, which is negative when the goal has somehow
 *   been over-allocated (a state `assertWithinPool` treats as a refusal).
 * @throws {PoolBudgetError} `negative_pool` when either input is negative or not whole.
 */
export function remainingPool(budgetPool: number, allocated: number): number {
  if (!Number.isInteger(budgetPool) || !Number.isInteger(allocated) || budgetPool < 0 || allocated < 0) {
    throw new PoolBudgetError("negative_pool", "A budget pool and its allocation must be whole, non-negative credits.");
  }
  return budgetPool - allocated;
}

/**
 * Refuses a split that would take the pool past its budget.
 *
 * @param budgetPool - The goal's total pool.
 * @param allocated - Credits already allocated.
 * @param incoming - Credits the new split wants to add.
 * @returns The remaining (pre-split) credits, for callers that default an
 *   amount to "everything left".
 * @throws {PoolBudgetError} `bad_amount` for a bad `incoming`, `empty_pool`
 *   when the pool was declared with 0 credits, `over_allocated` when `incoming`
 *   exceeds what is left.
 */
export function assertWithinPool(budgetPool: number, allocated: number, incoming: number): number {
  assertCredits(incoming, "Split amount");
  const remaining = remainingPool(budgetPool, allocated);
  if (budgetPool === 0 && incoming > 0) {
    throw new PoolBudgetError("empty_pool", "This goal's budget pool is empty (0 credits).");
  }
  if (incoming > remaining) {
    throw new PoolBudgetError(
      "over_allocated",
      `This split asks for ${incoming} credits but only ${Math.max(0, remaining)} of the ${budgetPool}-credit pool are unallocated.`,
    );
  }
  return remaining;
}

/**
 * Splits `amount` proportionally across `weights` (largest-remainder rounding).
 *
 * A zero weight is legal and simply earns nothing; at least one weight must be
 * positive. The pieces sum to exactly `amount`.
 *
 * @param amount - Total credits to distribute.
 * @param weights - One non-negative integer weight per target.
 * @returns One amount per weight, summing to exactly `amount`.
 * @throws {PoolBudgetError} `bad_amount` for a negative/non-integer amount or a
 *   negative/non-integer weight, `bad_weights` when every weight is 0.
 */
export function splitProportional(amount: number, weights: readonly number[]): number[] {
  if (weights.length === 0) {
    throw new PoolBudgetError("bad_weights", "A proportional split needs at least one target.");
  }
  for (const weight of weights) {
    if (!Number.isInteger(weight) || weight < 0) {
      throw new PoolBudgetError("bad_weights", `Weights must be whole numbers, got ${weight}.`);
    }
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) {
    throw new PoolBudgetError("bad_weights", "A proportional split needs at least one positive weight.");
  }
  return largestRemainder(amount, weights, total);
}

/**
 * Splits `amount` by percentage shares that must total exactly 100 — the
 * milestone shape, where each milestone names its percent of the pool.
 *
 * @param amount - Total credits to distribute.
 * @param shares - One non-negative integer percentage per milestone.
 * @returns One amount per share, summing to exactly `amount`.
 * @throws {PoolBudgetError} `bad_shares` when the shares do not total 100,
 *   `bad_amount` for a bad amount or share.
 */
export function splitMilestones(amount: number, shares: readonly number[]): number[] {
  if (shares.length === 0) {
    throw new PoolBudgetError("bad_shares", "A milestone split needs at least one milestone.");
  }
  for (const share of shares) {
    if (!Number.isInteger(share) || share < 0) {
      throw new PoolBudgetError("bad_shares", `Shares must be whole percentages, got ${share}.`);
    }
  }
  const total = shares.reduce((sum, share) => sum + share, 0);
  if (total !== 100) {
    throw new PoolBudgetError("bad_shares", `Milestone shares must total exactly 100, got ${total}.`);
  }
  return largestRemainder(amount, shares, 100);
}

/**
 * Splits `amount` evenly across `count` targets; leftover credits go to the
 * earliest targets.
 *
 * @param amount - Total credits to distribute.
 * @param count - Number of targets; at least 1.
 * @returns One amount per target, summing to exactly `amount`.
 * @throws {PoolBudgetError} `bad_amount` for a bad amount, `bad_weights` when
 *   `count` is less than 1.
 */
export function splitEvenly(amount: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new PoolBudgetError("bad_weights", `An even split needs at least one target, got ${count}.`);
  }
  return largestRemainder(amount, new Array<number>(count).fill(1), count);
}

/**
 * Projects a goal's pool numbers into clamped, displayable values.
 *
 * @param budgetPool - The goal's total pool.
 * @param allocated - The credits already carved out by live allocations.
 * @returns Remaining credits, utilization percent, and a coarse split status.
 */
export function describeBudget(budgetPool: number, allocated: number): GoalBudgetSummary {
  const pool = Math.max(0, budgetPool);
  const used = Math.max(0, allocated);
  const remaining = Math.max(0, pool - used);
  const utilizationPercent = pool === 0 ? 0 : Math.min(100, Math.round((used / pool) * 100));
  const splitStatus: GoalSplitStatus =
    pool === 0 ? "no-budget" : used === 0 ? "unfunded" : remaining === 0 ? "fully-split" : "partially-split";
  return { budgetPool: pool, allocated: used, remaining, utilizationPercent, splitStatus };
}

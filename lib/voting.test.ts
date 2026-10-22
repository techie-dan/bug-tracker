import { describe, expect, it } from "vitest";
import {
  calculateVoteChange,
  isValidVoteDirection,
  reconcileVoteCount,
} from "./voting";

describe("isValidVoteDirection", () => {
  it("accepts like (1) and dislike (-1)", () => {
    expect(isValidVoteDirection(1)).toBe(true);
    expect(isValidVoteDirection(-1)).toBe(true);
  });

  it("rejects out-of-range or malformed directions", () => {
    for (const bad of [100, -2, 0, 2, 1.5, "1", "-1", null, undefined, NaN]) {
      expect(isValidVoteDirection(bad)).toBe(false);
    }
  });
});

describe("calculateVoteChange", () => {
  it("upvotes from neutral (0 -> +1)", () => {
    expect(calculateVoteChange(0, 1)).toEqual({
      nextVote: 1,
      countDelta: 1,
    });
    expect(calculateVoteChange(null, 1)).toEqual({
      nextVote: 1,
      countDelta: 1,
    });
    expect(calculateVoteChange(undefined, 1)).toEqual({
      nextVote: 1,
      countDelta: 1,
    });
  });

  it("downvotes from neutral (0 -> -1)", () => {
    expect(calculateVoteChange(0, -1)).toEqual({
      nextVote: -1,
      countDelta: -1,
    });
  });

  it("toggles off upvote (+1 -> 0)", () => {
    expect(calculateVoteChange(1, 1)).toEqual({
      nextVote: 0,
      countDelta: -1,
    });
  });

  it("toggles off downvote (-1 -> 0)", () => {
    expect(calculateVoteChange(-1, -1)).toEqual({
      nextVote: 0,
      countDelta: 1,
    });
  });

  it("switches from upvote to downvote (+1 -> -1)", () => {
    expect(calculateVoteChange(1, -1)).toEqual({
      nextVote: -1,
      countDelta: -2,
    });
  });

  it("switches from downvote to upvote (-1 -> +1)", () => {
    expect(calculateVoteChange(-1, 1)).toEqual({
      nextVote: 1,
      countDelta: 2,
    });
  });
});

describe("reconcileVoteCount (#362)", () => {
  it("calculates accurate voteCount from like and dislike counts", () => {
    // #1059: dislikes no longer count; the stored count is the upvotes.
    expect(reconcileVoteCount(5, 2)).toBe(5);
    expect(reconcileVoteCount(0, 3)).toBe(0);
    expect(reconcileVoteCount(4, 4)).toBe(4);
    expect(reconcileVoteCount(0, 0)).toBe(0);
    expect(reconcileVoteCount(100, 0)).toBe(100);
  });

  it("ensures toggleVoteAction in app/actions/bugs.ts reconciles count from Vote rows (#362)", async () => {
    const { readFileSync } = await import("fs");
    const source = readFileSync("app/actions/issues.ts", "utf8");

    // Guard: relative increment must not be used to prevent race-condition counter drift
    expect(source).not.toContain('"voteCount" + ${countDelta}');
    expect(source).not.toContain("{ increment: countDelta }");

    // Guard: authoritative count must be computed from groupBy and written directly to Bug
    expect(source).toContain("const voteCount = reconcileVoteCount(likeCount, dislikeCount)");
    expect(source).toContain("await tx.bug.update({");
    expect(source).toContain("data: { voteCount }");

    // Guard: serialize vote changes using row-level locking
    expect(source).toContain('SELECT id FROM "Bug" WHERE id = ${bugId} FOR UPDATE');
  });

  it("ensures all bug-modifying actions lock the row to avoid voteCount race conditions (#676)", async () => {
    const { readFileSync } = await import("fs");
    const source = readFileSync("app/actions/issues.ts", "utf8");

    // Guard: row-level locking must be used across all operations that modify the bug or affect vote state
    const matches = source.match(/SELECT id FROM "Bug" WHERE id = \$\{bugId\} FOR UPDATE/g);
    expect(matches?.length).toBeGreaterThanOrEqual(5);

    // Guard: restoreBugAction must reconcile voteCount upon restoring
    expect(source).toContain("voteCount = reconcileVoteCount(likeCount, dislikeCount)");

    // Guard: createBugAction initializes voteCount explicitly
    expect(source).toContain("voteCount: 0");
  });
});

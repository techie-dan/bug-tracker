import { describe, expect, it } from "vitest";
import {
  parseProjectRewardConfig,
  calculateSolverPoints,
  calculateReporterPoints,
  calculateReviewerPoints,
} from "./project-rewards";
import { SOLVER_POINTS, REPORTER_POINTS, REVIEWER_POINTS } from "./rules";

describe("project-rewards", () => {
  it("uses default point values when config is empty or invalid", () => {
    const config = parseProjectRewardConfig(null);
    expect(config.solver.low).toBe(SOLVER_POINTS.low);
    expect(config.solver.medium).toBe(SOLVER_POINTS.medium);
    expect(config.solver.high).toBe(SOLVER_POINTS.high);
    expect(config.solver.critical).toBe(SOLVER_POINTS.critical);
    expect(config.reporter).toBe(REPORTER_POINTS);
    expect(config.reviewer).toBe(REVIEWER_POINTS);
    expect(config.guidelines).toBeNull();

    expect(calculateSolverPoints("critical", config)).toBe(SOLVER_POINTS.critical);
    expect(calculateReporterPoints(config)).toBe(REPORTER_POINTS);
    expect(calculateReviewerPoints(config)).toBe(REVIEWER_POINTS);
  });

  it("parses valid custom reward configs and computes points accordingly", () => {
    const raw = {
      solver: {
        low: 10,
        medium: 20,
        high: 30,
        critical: 40,
      },
      reporter: 5,
      reviewer: 8,
      guidelines: "Bonus points for high quality repro steps",
    };

    const config = parseProjectRewardConfig(raw);
    expect(config.solver.low).toBe(10);
    expect(config.solver.critical).toBe(40);
    expect(config.reporter).toBe(5);
    expect(config.reviewer).toBe(8);
    expect(config.guidelines).toBe("Bonus points for high quality repro steps");

    expect(calculateSolverPoints("low", config)).toBe(10);
    expect(calculateSolverPoints("critical", config)).toBe(40);
    expect(calculateReporterPoints(config)).toBe(5);
    expect(calculateReviewerPoints(config)).toBe(8);
  });
});

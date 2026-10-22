import { describe, expect, it } from "vitest";
import { DISPATCH_RUNS_PER_MINUTE, dispatchRunsPerMinute } from "./dispatch-limit";

describe("dispatchRunsPerMinute (#679)", () => {
  it("defaults to 12 when unset, blank or not a positive whole number", () => {
    expect(DISPATCH_RUNS_PER_MINUTE).toBe(12);
    for (const raw of [undefined, "", "  ", "0", "-3", "2.5", "lots"]) {
      expect(dispatchRunsPerMinute(raw)).toBe(12);
    }
  });

  it("uses the configured value, capped at 120", () => {
    expect(dispatchRunsPerMinute("1")).toBe(1);
    expect(dispatchRunsPerMinute(" 30 ")).toBe(30);
    expect(dispatchRunsPerMinute("5000")).toBe(120);
  });
});

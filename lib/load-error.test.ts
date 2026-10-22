import { afterEach, describe, expect, it, vi } from "vitest";
import { logLoadFailure } from "./load-error";

describe("logLoadFailure", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  afterEach(() => consoleError.mockClear());

  it("logs the full error under the label, with the reference it returns", () => {
    const error = new Error("The column `Bug.tenantId` does not exist in the current database.");
    const reference = logLoadFailure("[bugs] list query failed", error);

    expect(reference).toMatch(/^[0-9a-f]{8}$/);
    expect(consoleError).toHaveBeenCalledWith(`[bugs] list query failed (ref ${reference})`, error);
  });

  it("gives each failure its own reference", () => {
    expect(logLoadFailure("[x]", new Error("a"))).not.toBe(logLoadFailure("[x]", new Error("b")));
  });
});

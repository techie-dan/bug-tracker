import { describe, expect, it, vi } from "vitest";
import { ensureWatching, resolveWatchers } from "./watch";

describe("resolveWatchers (#216)", () => {
  it("includes the people involved by default", () => {
    expect(resolveWatchers(["reporter", "assignee", null], [])).toEqual(["reporter", "assignee"]);
  });

  it("adds people who chose Watch", () => {
    expect(resolveWatchers(["reporter"], [{ userId: "fan", watching: true }])).toEqual(["reporter", "fan"]);
  });

  it("drops people who chose Unwatch, even if involved", () => {
    expect(
      resolveWatchers(["reporter", "assignee"], [{ userId: "assignee", watching: false }]),
    ).toEqual(["reporter"]);
  });

  it("lists each person once", () => {
    expect(
      resolveWatchers(["a", "a"], [{ userId: "a", watching: true }, { userId: "b", watching: true }]),
    ).toEqual(["a", "b"]);
  });
});

describe("ensureWatching", () => {
  it("adds rows without overriding existing choices", async () => {
    const createMany = vi.fn();
    await ensureWatching({ issueWatch: { createMany } } as never, "b1", ["a", null, "a", "b"]);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { userId: "a", bugId: "b1", watching: true },
        { userId: "b", bugId: "b1", watching: true },
      ],
      skipDuplicates: true,
    });
  });

  it("does nothing when nobody is given", async () => {
    const createMany = vi.fn();
    await ensureWatching({ issueWatch: { createMany } } as never, "b1", [null]);
    expect(createMany).not.toHaveBeenCalled();
  });
});

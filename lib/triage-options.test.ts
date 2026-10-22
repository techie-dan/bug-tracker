import { describe, expect, it } from "vitest";
import { triageFieldsKey, withCurrentOption } from "./triage-options";

const active = [
  { id: "fix", name: "Fix" },
  { id: "design", name: "Design" },
];

describe("withCurrentOption (#115)", () => {
  it("returns the active list when the issue has no value", () => {
    expect(withCurrentOption(active, null)).toBe(active);
    expect(withCurrentOption(active, undefined)).toBe(active);
  });

  it("returns the active list when the current value is active", () => {
    expect(withCurrentOption(active, { id: "fix", name: "Fix", isActive: true })).toBe(active);
  });

  it("keeps a deactivated current value selectable, labelled inactive", () => {
    const options = withCurrentOption(active, { id: "feat", name: "Feat", isActive: false });
    expect(options).toEqual([...active, { id: "feat", name: "Feat (inactive)" }]);
  });

  it("does not modify the original list", () => {
    withCurrentOption(active, { id: "feat", name: "Feat" });
    expect(active).toHaveLength(2);
  });
});

describe("triageFieldsKey (#261)", () => {
  const saved = {
    status: "in_progress",
    severity: "medium",
    typeId: "fix",
    categoryId: "web",
    areaId: "frontend",
    assigneeId: "user-1",
  };

  it("is stable while the saved values are unchanged", () => {
    expect(triageFieldsKey(saved)).toBe(triageFieldsKey({ ...saved }));
  });

  it.each([
    ["status", { status: "resolved" }],
    ["severity", { severity: "high" }],
    ["type", { typeId: "design" }],
    ["platform", { categoryId: null }],
    ["area", { areaId: "backend" }],
    ["assignee", { assigneeId: "user-2" }],
  ])("changes when the saved %s changes, so the fields remount", (_field, change) => {
    expect(triageFieldsKey({ ...saved, ...change })).not.toBe(triageFieldsKey(saved));
  });

  it("treats a missing value the same as an empty one", () => {
    const empty = { status: "open", severity: "low" };
    expect(triageFieldsKey(empty)).toBe(
      triageFieldsKey({ ...empty, typeId: null, categoryId: undefined, areaId: null, assigneeId: null }),
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  daysUntil,
  dueDateValue,
  dueLabel,
  MILESTONE_PARAM,
  milestoneIssuesHref,
  milestoneParamValue,
  milestoneProgress,
  milestoneWhere,
  parseDueDate,
  parseMilestoneFilter,
} from "./milestones";
import { SHOW_RESOLVED_PARAM, parseShowResolved } from "./issue-state";
import { DUPLICATES_PARAM, parseShowDuplicates } from "./duplicates";

describe("due dates", () => {
  it("parses a calendar day to UTC midnight and back", () => {
    const d = parseDueDate("2026-10-31");
    expect(d).toEqual(new Date("2026-10-31T00:00:00.000Z"));
    expect(dueDateValue(d as Date)).toBe("2026-10-31");
  });
  it("treats blank as no date and rejects nonsense", () => {
    expect(parseDueDate("")).toBeNull();
    expect(parseDueDate("2026-02-30")).toBe("invalid");
    expect(parseDueDate("31/10/2026")).toBe("invalid");
  });
  it("labels relative to the viewer's day", () => {
    expect(daysUntil("2026-10-20", "2026-10-18")).toBe(2);
    expect(dueLabel("2026-10-18", "2026-10-18")).toEqual({ text: "Due today", tone: "soon" });
    expect(dueLabel("2026-10-19", "2026-10-18").text).toBe("Due tomorrow");
    expect(dueLabel("2026-10-17", "2026-10-18")).toEqual({ text: "Overdue by 1 day", tone: "overdue" });
    expect(dueLabel("2026-11-30", "2026-10-18").tone).toBe("later");
    expect(dueLabel("2026-10-01", "2026-10-18", true)).toEqual({ text: "Closed", tone: "done" });
  });
});

describe("milestoneProgress", () => {
  it("is done over total, as a whole percent", () => {
    expect(milestoneProgress(1, 3)).toEqual({ done: 1, total: 3, percent: 33 });
    expect(milestoneProgress(0, 0)).toEqual({ done: 0, total: 0, percent: 0 });
    expect(milestoneProgress(5, 3).done).toBe(3);
  });
});

describe("milestone filter", () => {
  const known = [{ id: "m1" }];
  it("reads an id, none, or nothing", () => {
    expect(parseMilestoneFilter("m1", known)).toEqual({ id: "m1" });
    expect(parseMilestoneFilter("none", known)).toBe("none");
    expect(parseMilestoneFilter("gone", known)).toBeNull();
    expect(parseMilestoneFilter(undefined, known)).toBeNull();
  });
  it("builds the where and round-trips the param", () => {
    expect(milestoneWhere({ id: "m1" })).toEqual({ milestoneId: "m1" });
    expect(milestoneWhere("none")).toEqual({ milestoneId: null });
    expect(milestoneWhere(null)).toEqual({});
    expect(milestoneParamValue("none")).toBe("none");
    expect(milestoneParamValue({ id: "m1" })).toBe("m1");
  });
});

describe("milestoneIssuesHref", () => {
  // The link reads "All N issues", and N counts resolved, closed and
  // duplicate issues, which the list hides unless asked (#1058, #285).
  const href = milestoneIssuesHref("m1");
  const url = new URL(href, "https://ziki.dev");

  it("opens the issues list filtered to the milestone", () => {
    expect(url.pathname).toBe("/issues");
    expect(parseMilestoneFilter(url.searchParams.get(MILESTONE_PARAM) ?? undefined, [{ id: "m1" }])).toEqual({ id: "m1" });
  });

  it("asks the list to show resolved and closed issues", () => {
    expect(parseShowResolved(url.searchParams.get(SHOW_RESOLVED_PARAM))).toBe(true);
  });

  it("asks the list to show duplicates", () => {
    expect(parseShowDuplicates(url.searchParams.get(DUPLICATES_PARAM) ?? undefined)).toBe(true);
  });

  it("encodes the id", () => {
    expect(new URL(milestoneIssuesHref("a&b"), "https://ziki.dev").searchParams.get(MILESTONE_PARAM)).toBe("a&b");
  });
});

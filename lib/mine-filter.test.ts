import { describe, expect, it } from "vitest";
import { mineFilterWhere, parseMineFilter } from "./mine-filter";

describe("parseMineFilter", () => {
  it("accepts the options, case-insensitively", () => {
    expect(parseMineFilter("assigned")).toBe("assigned");
    expect(parseMineFilter(" Reported ")).toBe("reported");
    expect(parseMineFilter(" Created ")).toBe("created");
    expect(parseMineFilter("watching")).toBe("watching");
  });

  it("uses the first value when the parameter is repeated", () => {
    expect(parseMineFilter(["reported", "assigned"])).toBe("reported");
    expect(parseMineFilter(["created", "assigned"])).toBe("created");
  });

  it("ignores anything else", () => {
    expect(parseMineFilter(undefined)).toBeNull();
    expect(parseMineFilter("")).toBeNull();
    expect(parseMineFilter("everyone")).toBeNull();
  });
});

describe("mineFilterWhere", () => {
  it("filters by assignee or reporter", () => {
    expect(mineFilterWhere("assigned", "u1")).toEqual({ assigneeId: "u1" });
    expect(mineFilterWhere("reported", "u1")).toEqual({ reporterId: "u1" });
    expect(mineFilterWhere("created", "u1")).toEqual({ reporterId: "u1" });
  });

  it("falls back to all issues for the retired mine view", () => {
    expect(parseMineFilter(" Mine ")).toBeNull();
    expect(parseMineFilter(["mine", "assigned"])).toBeNull();
    expect(mineFilterWhere(parseMineFilter("mine"), "u1")).toEqual({});
  });

  it("does nothing without a filter or a user", () => {
    expect(mineFilterWhere(null, "u1")).toEqual({});
    expect(mineFilterWhere("assigned", undefined)).toEqual({});
    expect(mineFilterWhere("created", undefined)).toEqual({});
  });
});

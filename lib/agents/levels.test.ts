import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentLevelError,
  OWNER_REVIEW_LIMIT,
  SEPARATE_LEVEL_AGENTS,
  canSetLevel,
  hasLevel,
  isAgentLevel,
  requireLevel,
  settableLevels,
} from "./levels";

describe("agent levels (#427)", () => {
  it("orders the ladder so each level includes the ones below", () => {
    expect(hasLevel("merger", "observer")).toBe(true);
    expect(hasLevel("reviewer", "contributor")).toBe(true);
    expect(hasLevel("contributor", "contributor")).toBe(true);
    expect(hasLevel("observer", "contributor")).toBe(false);
    expect(hasLevel("reviewer", "merger")).toBe(false);
  });

  it("requireLevel throws a 403-shaped error below the level", () => {
    expect(() => requireLevel({ level: "contributor" }, "contributor")).not.toThrow();
    expect(() => requireLevel({ level: "observer" }, "contributor")).toThrow(AgentLevelError);
    try {
      requireLevel({ level: "observer" }, "reviewer");
    } catch (error) {
      expect((error as AgentLevelError).required).toBe("reviewer");
    }
  });

  it("lets the owner set anything but merger, and a tenant admin anything", () => {
    const owner = { isOwner: true, isTenantAdmin: false };
    expect(canSetLevel(owner, "reviewer")).toBe(true);
    expect(canSetLevel(owner, "triager")).toBe(true);
    expect(canSetLevel(owner, "merger")).toBe(false);
    expect(canSetLevel(owner, "dispatcher")).toBe(true);
    expect(canSetLevel({ isOwner: false, isTenantAdmin: true }, "merger")).toBe(true);
    expect(canSetLevel({ isOwner: false, isTenantAdmin: true }, "dispatcher")).toBe(true);
    expect(canSetLevel({ isOwner: false, isTenantAdmin: false }, "observer")).toBe(false);
    expect(settableLevels(owner)).toEqual(["observer", "contributor", "triager", "reviewer", "dispatcher"]);
  });

  it("tells a person to keep one agent per level, without calling that a review", () => {
    expect(SEPARATE_LEVEL_AGENTS).toMatch(/observer/);
    expect(SEPARATE_LEVEL_AGENTS).toMatch(/contributor/);
    expect(SEPARATE_LEVEL_AGENTS).toMatch(/reviewer/);
    expect(SEPARATE_LEVEL_AGENTS).toMatch(/merger/);
    expect(OWNER_REVIEW_LIMIT).toMatch(/not an independent reviewer/);
    expect(OWNER_REVIEW_LIMIT).toMatch(/ticket you filed/);
    const doc = readFileSync(path.resolve(__dirname, "../../docs/ziki-for-agents.md"), "utf8");
    expect(doc).toContain("separate agent for each level");
    expect(doc).toContain("Independence is by **owner**, not by agent");
  });

  it("recognises only real levels, so a forged body can't set one", () => {
    expect(isAgentLevel("merger")).toBe(true);
    expect(isAgentLevel("admin")).toBe(false);
    expect(isAgentLevel(undefined)).toBe(false);
  });
});

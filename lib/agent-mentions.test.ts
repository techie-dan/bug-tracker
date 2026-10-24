import { describe, expect, it, vi } from "vitest";
import { agentMentionNames, agentOwnerIds, mentionedAgents } from "./agent-mentions";

describe("agent mentions (#603)", () => {
  it("looks up only live agents in the issue's tenant", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "a1", name: "Mark's Claude", ownerUserId: "mark" }]);
    const db = { agent: { findMany } } as never;
    const agents = await mentionedAgents(db, "tenant-a", "hey @[Mark's Claude](agent:a1) and @[Bob](bob)");
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ["a1"] }, tenantId: "tenant-a", revokedAt: null },
      select: { id: true, name: true, ownerUserId: true },
    });
    expect(agents).toEqual([{ id: "a1", name: "Mark's Claude", ownerUserId: "mark" }]);
  });

  it("skips the query when no agent is mentioned", async () => {
    const findMany = vi.fn();
    expect(await mentionedAgents({ agent: { findMany } } as never, "tenant-a", "@[Bob](bob)")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("maps agent tags to names and dedupes owners", () => {
    const agents = [
      { id: "a1", name: "Mark's Claude", ownerUserId: "mark" },
      { id: "a2", name: "Mark's GPT", ownerUserId: "mark" },
    ];
    expect(agentMentionNames(agents)).toEqual([["agent:a1", "Mark's Claude"], ["agent:a2", "Mark's GPT"]]);
    expect(agentOwnerIds(agents)).toEqual(["mark"]);
  });
});

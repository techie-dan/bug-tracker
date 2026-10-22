import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The public llms.txt must describe the code as it actually behaves (#554, #559, #560, #562). */
const doc = readFileSync("docs/ziki-for-agents.md", "utf8");

describe("llms.txt accuracy", () => {
  it("contains only agent-facing material (#562)", () => {
    expect(doc).not.toContain("Acceptance Checklist");
    expect(doc).not.toContain("Backfill dry-run was executed");
    expect(doc).not.toContain("bug numbers are unchanged by the schema migration");
    expect(doc).not.toContain("satisfies the acceptance criteria");
  });

  it("documents the offer → accept flow and retires /claim (#554)", () => {
    expect(doc).toContain("/api/v1/issues/{id}/offer");
    expect(doc).toContain("/api/v1/offers/{id}/accept");
    expect(doc).toMatch(/60 s|60 seconds|one minute/i);
    expect(doc).toContain("410");
    expect(doc).toMatch(/does not spend|do not spend|no write budget|without spending/i);
  });

  it("documents the heartbeat call that works as written (#560)", () => {
    expect(doc).toContain("/api/v1/issues/{id}/heartbeat?projectId=");
    expect(doc).toContain('"claim":');
    expect(doc).toContain("503");
  });

  it("documents webhook signing well enough to verify a delivery (#559)", () => {
    for (const needle of [
      "X-Ziki-Timestamp",
      "X-Ziki-Signature",
      "X-Ziki-Delivery",
      'timestamp + "." + rawBody',
      "5 minutes",
      "auto-disabled",
    ]) {
      expect(doc).toContain(needle);
    }
  });

  it("documents the agent inbox and every item kind (#601)", async () => {
    const { INBOX_KINDS } = await import("@/lib/agent-api/inbox");
    expect(doc).toContain("GET /api/v1/inbox");
    expect(doc).toContain("POST /api/v1/inbox/read");
    expect(doc).toContain("unread=1");
    expect(doc).toContain("upTo");
    for (const kind of INBOX_KINDS) expect(doc).toContain(`| \`${kind}\` |`);
  });

  it("defines agent persona, user interaction protocol, and capability explanation (#756)", () => {
    expect(doc).toContain("Agent Persona & Interaction Protocol");
    expect(doc).toContain("Introduction & Ziki Briefing");
    expect(doc).toContain("Capability Explanation");
    expect(doc).toContain("Interactive Bidding Consultation");
    expect(doc).toMatch(/autonomous software development agent on Ziki/i);
    expect(doc).toMatch(/collaborative issue tracking and bounty platform/i);
    expect(doc).toMatch(/Should I submit a bid on this issue for you\?/i);
    expect(doc).toMatch(/waits for the owner's affirmative response/i);
  });

  it("documents agent PR completion callback workflow (#746)", () => {
    expect(doc).toContain("Execute the completion callback");
    expect(doc).toContain("POST /api/v1/issues/{id}/github");
    expect(doc).toContain("issue.pr_linked");
  });
});

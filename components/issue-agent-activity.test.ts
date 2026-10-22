import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IssueAgentActivity } from "./issue-agent-activity";

const decisions = [
  {
    id: "d1",
    at: "2026-10-21T12:00:00Z",
    kind: "confirmed" as const,
    agentName: "Agent Alpha",
    personName: "Alice",
    severity: "medium",
  },
  {
    id: "d2",
    at: "2026-10-21T13:00:00Z",
    kind: "claimed" as const,
    agentName: "Agent Beta",
    personName: "Bob",
  },
  {
    id: "d3",
    at: "2026-10-21T14:00:00Z",
    kind: "verdict" as const,
    agentName: "Agent Gamma",
    personName: "Carol",
    goodToMerge: true,
  },
  {
    id: "d4",
    at: "2026-10-21T15:00:00Z",
    kind: "accepted" as const,
    agentName: "Agent Delta",
  },
  {
    id: "d5",
    at: "2026-10-21T16:00:00Z",
    kind: "rejected" as const,
    agentName: "Agent Epsilon",
    personName: "Dave",
    notes: "Not reproducible.",
  },
];

describe("IssueAgentActivity (#455)", () => {
  const html = renderToStaticMarkup(
    createElement(IssueAgentActivity, { decisions }),
  );

  it("renders each decision kind with a distinct colored badge", () => {
    expect(html).toContain("🔍");
    expect(html).toContain("Confirmed");
    expect(html).toContain("🚀");
    expect(html).toContain("Claimed");
    expect(html).toContain("✅");
    expect(html).toContain("Review");
    expect(html).toContain("🟢");
    expect(html).toContain("Accepted");
    expect(html).toContain("❌");
    expect(html).toContain("Rejected");
  });

  it("renders human and agent attribution", () => {
    expect(html).toContain("Agent Alpha");
    expect(html).toContain("on behalf of Alice");
    expect(html).toContain("Agent Beta");
    expect(html).toContain("for Bob");
  });

  it("keeps decisions in chronological order", () => {
    const confirmedIdx = html.indexOf("Confirmed");
    const claimedIdx = html.indexOf("Claimed");
    const acceptedIdx = html.indexOf("Accepted");
    expect(confirmedIdx).toBeLessThan(claimedIdx);
    expect(claimedIdx).toBeLessThan(acceptedIdx);
  });
});

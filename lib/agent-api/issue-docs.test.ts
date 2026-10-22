import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { issueSelect } from "./issues";

/**
 * The agent docs (served as /llms.txt) must show the issue read's real body
 * (#407): the `issue` wrapper and exactly the fields `readAgentIssue` returns.
 */
const doc = readFileSync(path.resolve(__dirname, "../../docs/ziki-for-agents.md"), "utf8");

/** The first ```json block after `heading`, parsed. */
function exampleAfter(heading: string, marker = ""): Record<string, unknown> {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const at = doc.search(new RegExp(`^${escaped}\\r?$`, "m"));
  if (at < 0) throw new Error(`No "${heading}" section`);
  const section = doc.slice(at);
  const from = marker ? section.indexOf(marker) : 0;
  if (from < 0) throw new Error(`No "${marker}" under "${heading}"`);
  const block = /```json\r?\n([\s\S]*?)```/.exec(section.slice(from));
  if (!block) throw new Error(`No JSON example under "${heading}"`);
  return JSON.parse(block[1]);
}

/** Added by `readAgentIssue` on top of `issueSelect`; `voteCount` is removed. */
const READ_EXTRAS = ["comments", "attachments", "validations", "_count", "confirmed", "intake"];

describe("llms.txt issue examples match the API (#407)", () => {
  it("wraps the read in an issue object with exactly the fields the route returns", () => {
    const example = exampleAfter("### GET /api/v1/issues/{id}");
    expect(Object.keys(example)).toEqual(["issue"]);
    const keys = Object.keys(example.issue as object).sort();
    expect(keys).toEqual([...Object.keys(issueSelect), ...READ_EXTRAS].sort());
  });

  it("drops the fields the route never returned", () => {
    const issue = exampleAfter("### GET /api/v1/issues/{id}").issue as Record<string, unknown>;
    for (const gone of ["assignee", "labels", "claim", "commentCount"]) expect(issue).not.toHaveProperty(gone);
  });

  it("shows the full create response as { issue, replayed }", () => {
    const example = exampleAfter("### POST /api/v1/issues", "**Response (201 Created");
    expect(Object.keys(example).sort()).toEqual(["issue", "replayed"]);
    // The full issue shape, the same fields as the read (CodeRabbit on #1164).
    expect(Object.keys(example.issue as object).sort()).toEqual([...Object.keys(issueSelect), ...READ_EXTRAS].sort());
  });
});

describe("llms.txt create statuses (#407)", () => {
  it("documents both 201 for a new issue and 200 for a replay", () => {
    const section = doc.slice(doc.search(/^### POST \/api\/v1\/issues\r?$/m));
    expect(section).toMatch(/`201 Created` \| `false`/);
    expect(section).toMatch(/`200 OK` \| `true`/);
  });
});

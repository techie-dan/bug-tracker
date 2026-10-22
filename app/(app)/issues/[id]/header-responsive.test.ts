import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(path.resolve(__dirname, "page.tsx"), "utf8");

describe("Bug detail header responsive layout (#698)", () => {
  it("renders a compact mobile action row pinned directly under the title before badges and votes", () => {
    // Mobile action row must be directly under the title
    expect(pageSource).toMatch(
      /<h1[\s\S]*?<\/h1>[\s\S]*?data-testid="mobile-actions-row"[\s\S]*?Badge[\s\S]*?<VoteButton/
    );

    // Mobile action row has horizontal scroll and is hidden on desktop (sm:hidden)
    const mobileRowMatch = pageSource.match(
      /data-testid="mobile-actions-row"[\s\S]*?className="([^"]+)"/
    );
    expect(mobileRowMatch).toBeTruthy();
    const mobileClasses = mobileRowMatch![1];
    expect(mobileClasses).toContain("overflow-x-auto");
    expect(mobileClasses).toContain("sm:hidden");
    expect(mobileClasses).toContain("flex");
    expect(mobileClasses).toContain("gap-2");
  });

  it("includes SelfAssignButton in the header action row so Assign is immediately reachable", () => {
    expect(pageSource).toMatch(
      /headerActions[\s\S]*?canSelfAssign[\s\S]*?<SelfAssignButton/
    );
  });

  it("keeps status and severity visible at every width, folding only supplementary workflow badges into +N", () => {
    // Workflow row leads with status then severity, both unconditionally visible.
    expect(pageSource).toMatch(
      /statusClass\[bug\.status\][\s\S]*?severityClass\[bug\.severity\]/
    );

    // The +N control still exists for mobile, and now counts only boost/volunteer.
    expect(pageSource).toMatch(
      /<details className="group sm:contents">[\s\S]*?<summary[\s\S]*?\+\{extraBadgeCount\}[\s\S]*?<\/summary>/
    );
    expect(pageSource).toMatch(
      /const extraBadgeCount =[\s\S]*?isBoosted[\s\S]*?volunteerCount/
    );

    // Taxonomy no longer hides inside the overflow control's `contents` span.
    const contentsSpan = pageSource.match(
      /<span className="contents">([\s\S]*?)<\/span>\s*<\/details>/
    );
    expect(contentsSpan).toBeTruthy();
    expect(contentsSpan![1]).not.toMatch(/bug\.type|bug\.category|voteCount/);
  });

  it("anchors the desktop action cluster to the title's top edge (#687)", () => {
    // The back-link sits above the title, so the action cluster needs enough
    // top padding to clear it and share the title's top edge.
    expect(pageSource).toContain(
      '<div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:pt-9 print:hidden">'
    );

    // Danger zone remains at the bottom of the page
    expect(pageSource).toMatch(/Danger zone[\s\S]*?<DeleteIssueButton/);
  });
});

describe("Bug detail header hierarchy (#687)", () => {
  it("keeps workflow badges and taxonomy on separate rows", () => {
    // The workflow row closes, then a muted taxonomy line follows it.
    expect(pageSource).toMatch(
      /flex flex-wrap items-center gap-2[\s\S]*?severityClass\[bug\.severity\][\s\S]*?<\/div>[\s\S]*?text-xs text-slate-500[\s\S]*?bug\.type\.name[\s\S]*?bug\.category\.name/
    );
  });

  it("drops the redundant score pill so only VoteButton shows the vote total", () => {
    expect(pageSource).not.toMatch(/score \(\{/);
    expect(pageSource).not.toMatch(/\{bug\.voteCount\} score/);
  });
});

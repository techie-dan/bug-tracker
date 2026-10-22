import { describe, expect, it } from "vitest";
import {
  formatProofLinkLabel,
  isGitHubUrl,
  isHttpUrl,
  parseGitHubResourceUrl,
  splitProofLinkLines,
} from "./proof-links";

describe("splitProofLinkLines", () => {
  it("returns empty array for blank input", () => {
    expect(splitProofLinkLines("")).toEqual([]);
    expect(splitProofLinkLines("   \n  ")).toEqual([]);
    expect(splitProofLinkLines(undefined)).toEqual([]);
  });

  it("splits and trims newline-separated URLs", () => {
    expect(
      splitProofLinkLines(
        " https://github.com/org/repo/issues/1 \n\nhttps://github.com/org/repo/pull/2\n",
      ),
    ).toEqual([
      "https://github.com/org/repo/issues/1",
      "https://github.com/org/repo/pull/2",
    ]);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpUrl("https://cdn.example.com/shot.png")).toBe(true);
    expect(isHttpUrl("http://localhost:3000/clip.webm")).toBe(true);
  });

  it("rejects non-http schemes and invalid strings", () => {
    expect(isHttpUrl("ftp://files.example.com/a")).toBe(false);
    expect(isHttpUrl("not-a-url")).toBe(false);
  });
});

describe("isGitHubUrl", () => {
  it("accepts valid GitHub issue, pull request, repo, and gist URLs", () => {
    expect(isGitHubUrl("https://github.com/Zedu-Endor/bug-tracker/issues/99")).toBe(true);
    expect(isGitHubUrl("https://github.com/zeduchat/bug-tracker/pull/12")).toBe(true);
    expect(isGitHubUrl("https://github.com/facebook/react")).toBe(true);
    expect(isGitHubUrl("https://www.github.com/org/repo/issues/1")).toBe(true);
    expect(isGitHubUrl("https://gist.github.com/user/123456")).toBe(true);
    expect(isGitHubUrl("http://github.com/org/repo/issues/1")).toBe(true);
  });

  it("rejects non-GitHub URLs", () => {
    expect(isGitHubUrl("https://cdn.example.com/shot.png")).toBe(false);
    expect(isGitHubUrl("https://gitlab.com/org/repo/issues/1")).toBe(false);
    expect(isGitHubUrl("https://bitbucket.org/org/repo")).toBe(false);
    expect(isGitHubUrl("https://google.com")).toBe(false);
    expect(isGitHubUrl("https://fakegithub.com/org/repo")).toBe(false);
  });

  it("rejects GitHub URLs without a path", () => {
    expect(isGitHubUrl("https://github.com")).toBe(false);
    expect(isGitHubUrl("https://github.com/")).toBe(false);
    expect(isGitHubUrl("https://www.github.com")).toBe(false);
  });

  it("rejects invalid URLs and non-http schemes", () => {
    expect(isGitHubUrl("ftp://github.com/org/repo/issues/1")).toBe(false);
    expect(isGitHubUrl("not-a-url")).toBe(false);
    expect(isGitHubUrl("")).toBe(false);
    expect(isGitHubUrl("https://github.com/org/repo/pull/12]")).toBe(false);
  });
});

describe("parseGitHubResourceUrl", () => {
  it("parses pull request URLs", () => {
    expect(parseGitHubResourceUrl("https://github.com/zedu/web/pull/123")).toEqual({
      owner: "zedu",
      repo: "web",
      number: 123,
      kind: "PR",
    });
    expect(parseGitHubResourceUrl("https://github.com/zedu/web/pulls/456")).toEqual({
      owner: "zedu",
      repo: "web",
      number: 456,
      kind: "PR",
    });
  });

  it("parses issue URLs", () => {
    expect(parseGitHubResourceUrl("https://github.com/Zedu-Endor/issue-tracker/issues/705")).toEqual({
      owner: "Zedu-Endor",
      repo: "issue-tracker",
      number: 705,
      kind: "issue",
    });
    expect(parseGitHubResourceUrl("https://github.com/Zedu-Endor/issue-tracker/issue/12")).toEqual({
      owner: "Zedu-Endor",
      repo: "issue-tracker",
      number: 12,
      kind: "issue",
    });
  });

  it("parses discussion URLs", () => {
    expect(parseGitHubResourceUrl("https://github.com/facebook/react/discussions/42")).toEqual({
      owner: "facebook",
      repo: "react",
      number: 42,
      kind: "discussion",
    });
  });

  it("handles URLs with query parameters, hash fragments, and subpaths", () => {
    expect(
      parseGitHubResourceUrl("https://github.com/org/repo/pull/123/files?diff=unified#diff-1"),
    ).toEqual({
      owner: "org",
      repo: "repo",
      number: 123,
      kind: "PR",
    });
  });

  it("strips .git extension from repo name", () => {
    expect(parseGitHubResourceUrl("https://github.com/org/repo.git/pull/99")).toEqual({
      owner: "org",
      repo: "repo",
      number: 99,
      kind: "PR",
    });
  });

  it("handles URLs without scheme", () => {
    expect(parseGitHubResourceUrl("github.com/org/repo/issues/10")).toEqual({
      owner: "org",
      repo: "repo",
      number: 10,
      kind: "issue",
    });
  });

  it("returns null for non-resource GitHub URLs", () => {
    expect(parseGitHubResourceUrl("https://github.com/org/repo")).toBeNull();
    expect(parseGitHubResourceUrl("https://github.com/org")).toBeNull();
    expect(parseGitHubResourceUrl("https://gist.github.com/user/123")).toBeNull();
  });

  it("returns null for non-GitHub URLs or invalid input", () => {
    expect(parseGitHubResourceUrl("https://gitlab.com/org/repo/issues/1")).toBeNull();
    expect(parseGitHubResourceUrl("https://example.com/pull/123")).toBeNull();
    expect(parseGitHubResourceUrl("not-a-url")).toBeNull();
    expect(parseGitHubResourceUrl("")).toBeNull();
    expect(parseGitHubResourceUrl(undefined)).toBeNull();
  });
});

describe("formatProofLinkLabel", () => {
  it("formats GitHub PR URLs into compact labels", () => {
    expect(formatProofLinkLabel("https://github.com/zedu/web/pull/123")).toBe(
      "zedu/web #123 · PR",
    );
  });

  it("formats GitHub issue URLs into compact labels", () => {
    expect(formatProofLinkLabel("https://github.com/Zedu-Endor/issue-tracker/issues/705")).toBe(
      "Zedu-Endor/issue-tracker #705 · issue",
    );
  });

  it("formats GitHub discussion URLs into compact labels", () => {
    expect(formatProofLinkLabel("https://github.com/facebook/react/discussions/42")).toBe(
      "facebook/react #42 · discussion",
    );
  });

  it("degrades unparseable non-GitHub URLs without protocol and preserves short URLs", () => {
    expect(formatProofLinkLabel("https://example.com/shot.png")).toBe("example.com/shot.png");
  });

  it("truncates long unparseable URLs so they never render as raw 60+ char walls", () => {
    const longUrl =
      "https://example.com/very/long/path/to/some/attached/evidence/artifact/screenshot.png";
    const label = formatProofLinkLabel(longUrl);
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label.endsWith("…")).toBe(true);
    expect(label).not.toContain("https://");
    expect(label.length).toBeGreaterThan(0);
  });

  it("falls back gracefully for non-resource GitHub links", () => {
    expect(formatProofLinkLabel("https://github.com/facebook/react")).toBe(
      "github.com/facebook/react",
    );
  });

  it("returns empty string for blank input", () => {
    expect(formatProofLinkLabel("")).toBe("");
    expect(formatProofLinkLabel("   ")).toBe("");
  });
});

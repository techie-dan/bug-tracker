// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/app/actions/issues", () => ({
  editProofLinksAction: vi.fn(),
}));

import { EditableProofLinks } from "./editable-proof-links";

describe("EditableProofLinks (#745, #705)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders GitHub PR heading and empty state copy", () => {
    render(<EditableProofLinks bugId="b1" initialLinks={[]} canEdit={true} />);

    expect(screen.getByText("GitHub PR")).toBeTruthy();
    expect(screen.getByText("No GitHub PR attached to this report.")).toBeTruthy();
  });

  it("renders compact label for PR links with full URL in href and title", () => {
    const prUrl = "https://github.com/zedu/web/pull/123";
    render(
      <EditableProofLinks
        bugId="b1"
        initialLinks={[prUrl]}
        canEdit={true}
      />
    );

    expect(screen.getByText("GitHub PR")).toBeTruthy();
    const link = screen.getByRole("link", { name: "zedu/web #123 · PR" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe(prUrl);
    expect(link.getAttribute("title")).toBe(prUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.querySelector("svg[aria-hidden='true']")).toBeTruthy();
  });

  it("renders compact label for issue links with kind and number visible", () => {
    const issueUrl = "https://github.com/Zedu-Endor/issue-tracker/issues/705";
    render(
      <EditableProofLinks
        bugId="b1"
        initialLinks={[issueUrl]}
        canEdit={true}
      />
    );

    const link = screen.getByRole("link", { name: "Zedu-Endor/issue-tracker #705 · issue" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe(issueUrl);
    expect(link.getAttribute("title")).toBe(issueUrl);
  });

  it("degrades unparseable non-GitHub links to truncated URL while preserving href and title", () => {
    const longUrl = "https://example.com/very/long/path/to/an/attached/audit/evidence/screenshot.png";
    render(
      <EditableProofLinks
        bugId="b1"
        initialLinks={[longUrl]}
        canEdit={true}
      />
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link.textContent).not.toBe(longUrl);
    expect(link.textContent).toContain("…");
    expect(link.getAttribute("href")).toBe(longUrl);
    expect(link.getAttribute("title")).toBe(longUrl);
  });
});

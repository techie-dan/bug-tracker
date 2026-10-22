// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssuePullRequest } from "./issue-pull-request";

describe("IssuePullRequest", () => {
  it("renders nothing when pullRequestUrl is null or undefined", () => {
    const { container: c1 } = render(<IssuePullRequest pullRequestUrl={null} />);
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(<IssuePullRequest pullRequestUrl={undefined} />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders GitHub PR link and pending review status badge when pullRequestUrl is present", () => {
    render(<IssuePullRequest pullRequestUrl="https://github.com/zedu/web/pull/123" />);

    const section = screen.getByTestId("attached-pr-section");
    expect(section).toBeTruthy();
    expect(screen.getByText("GitHub Pull Request")).toBeTruthy();

    const link = screen.getByRole("link", { name: /https:\/\/github.com\/zedu\/web\/pull\/123/i });
    expect(link.getAttribute("href")).toBe("https://github.com/zedu/web/pull/123");
    expect(link.getAttribute("target")).toBe("_blank");

    expect(screen.getByText(/PR Attached \/ Pending Review/i)).toBeTruthy();
  });
});

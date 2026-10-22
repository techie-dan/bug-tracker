// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/actions/issues", () => ({
  editBugContentAction: vi.fn(),
}));

vi.mock("@/components/markdown-editor", () => ({
  MarkdownEditor: () => null,
}));

import { EditableIssueDescription } from "./editable-issue-description";

afterEach(cleanup);

const base = {
  bugId: "bug_1",
  initialTitle: "Title",
  initialDescription: "Description body",
  canEdit: true,
  users: [],
};

const createdAt = new Date("2026-10-21T18:37:00Z");

describe("EditableIssueDescription created date (#422)", () => {
  it("renders the created date on the heading row", () => {
    const { container } = render(
      <EditableIssueDescription {...base} createdAt={createdAt} />,
    );

    const headingRow = container.querySelector("section > div");
    const time = headingRow?.querySelector("time");

    expect(time).not.toBeNull();
    expect(time).toHaveAttribute("datetime", createdAt.toISOString());
  });

  it("labels the date for screen readers", () => {
    const { getByText } = render(
      <EditableIssueDescription {...base} createdAt={createdAt} />,
    );

    expect(getByText(/Created/)).toHaveClass("sr-only");
  });

  it("does not render a date when none is supplied", () => {
    const { container } = render(<EditableIssueDescription {...base} />);

    expect(container.querySelector("time")).toBeNull();
  });

  it("keeps the edit action and the date on the same row", () => {
    const { container, getByRole } = render(
      <EditableIssueDescription {...base} createdAt={createdAt} />,
    );

    const headingRow = container.querySelector("section > div");
    const actionRow = getByRole("button", { name: "Edit" }).parentElement;

    expect(headingRow).toContainElement(actionRow);
    expect(actionRow).toContainElement(container.querySelector("time"));
  });
});

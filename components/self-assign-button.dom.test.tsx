// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelfAssignButton } from "./self-assign-button";

vi.mock("@/app/actions/issues", () => ({ selfAssignBugAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));

afterEach(() => cleanup());

describe("SelfAssignButton focus indicator (#651)", () => {
  it.each([
    ["Assign to me", false],
    ["Unassign", true],
  ])("shows a visible focus ring on the ghost %s button", (name, isAssignedToMe) => {
    render(<SelfAssignButton bugId="bug_1" isAssignedToMe={isAssignedToMe} variant="ghost" size="xs" />);
    const classes = screen.getByRole("button", { name }).className;
    expect(classes).toContain("focus-visible:ring-2");
    expect(classes).toContain("focus-visible:ring-teal-700");
    expect(classes).toContain("focus-visible:ring-offset-2");
  });

  it("does not suppress the outline without a replacement", () => {
    render(<SelfAssignButton bugId="bug_1" isAssignedToMe={false} variant="ghost" />);
    const classes = screen.getByRole("button", { name: "Assign to me" }).className;
    if (classes.includes("outline-none")) expect(classes).toContain("focus-visible:ring-2");
  });
});

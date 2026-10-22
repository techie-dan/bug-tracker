// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownEditor } from "./markdown-editor";

afterEach(() => cleanup());

function renderEditor(value = "Hello **world**") {
  return render(<MarkdownEditor value={value} onChange={() => {}} aria-label="Description" />);
}

describe("MarkdownEditor Write/Preview switcher semantics (#652)", () => {
  it("uses toggle buttons in a labelled group, not tab roles without a tab pattern", () => {
    const { container } = renderEditor();
    expect(container.querySelector('[role="tab"], [role="tablist"], [aria-selected]')).toBeNull();
    const group = screen.getByRole("group", { name: "Editor view" });
    expect(group).toContainElement(screen.getByRole("button", { name: "Write" }));
    expect(group).toContainElement(screen.getByRole("button", { name: /Preview/ }));
  });

  it("announces the current view with aria-pressed and flips it on activation", async () => {
    const user = userEvent.setup();
    renderEditor();
    const write = screen.getByRole("button", { name: "Write" });
    const preview = screen.getByRole("button", { name: /Preview/ });
    expect(write).toHaveAttribute("aria-pressed", "true");
    expect(preview).toHaveAttribute("aria-pressed", "false");

    await user.click(preview);
    expect(preview).toHaveAttribute("aria-pressed", "true");
    expect(write).toHaveAttribute("aria-pressed", "false");

    await user.click(write);
    expect(write).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles from the keyboard with Space and Enter, and keeps focus on the pressed button", async () => {
    const user = userEvent.setup();
    renderEditor();
    const write = screen.getByRole("button", { name: "Write" });
    const preview = screen.getByRole("button", { name: /Preview/ });

    preview.focus();
    await user.keyboard("{Enter}");
    expect(preview).toHaveAttribute("aria-pressed", "true");
    expect(preview).toHaveFocus();

    write.focus();
    await user.keyboard(" ");
    expect(write).toHaveAttribute("aria-pressed", "true");
    expect(write).toHaveFocus();
  });

  it("disables Preview when there is nothing to preview", () => {
    renderEditor("");
    expect(screen.getByRole("button", { name: /Preview/ })).toBeDisabled();
  });
});

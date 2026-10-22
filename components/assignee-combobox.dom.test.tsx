// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AssigneeCombobox } from "./assignee-combobox";

beforeAll(() => {
  // jsdom does not implement scrolling; the combobox calls it to keep the
  // active option in view.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

const people = [
  { id: "u1", name: "Ada Lovelace" },
  { id: "u2", name: "Bob Smith" },
  { id: "u3", name: "山田 太郎" },
];

function setup() {
  const onChange = vi.fn();
  const utils = render(
    createElement(AssigneeCombobox, {
      id: "assigneeId",
      name: "assigneeId",
      people,
      value: "",
      onChange,
    }),
  );
  const input = utils.getByRole("combobox");
  fireEvent.focus(input);
  return { ...utils, input, onChange };
}

describe("AssigneeCombobox IME composition (#483)", () => {
  it("does not select an assignee when Enter commits an IME candidate", () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "山田" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("also ignores the IME key code when isComposing is false", () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "Ada" } });

    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not move the highlight while composing", () => {
    const { input } = setup();
    const initial = input.getAttribute("aria-activedescendant");
    expect(initial).toMatch(/-none$/);

    fireEvent.keyDown(input, { key: "ArrowDown", isComposing: true });
    expect(input.getAttribute("aria-activedescendant")).toBe(initial);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toMatch(/-u1$/);
  });

  it("selects once composition has ended", () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "Ada" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("u1");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});

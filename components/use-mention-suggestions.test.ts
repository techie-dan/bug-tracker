// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { createElement, type KeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMentionSuggestions } from "./use-mention-suggestions";
import { MarkdownEditor } from "./markdown-editor";

afterEach(cleanup);

function setup() {
  const onChange = vi.fn();
  const { result } = renderHook(() => useMentionSuggestions({
    users: [{ id: "ada", name: "Ada" }, { id: "alan", name: "Alan" }],
    value: "@a",
    onChange,
    textareaRef: { current: null },
  }));
  act(() => result.current.sync("@a", 2));
  return { result, onChange };
}

function keyEvent(key: string, nativeEvent = {}) {
  return { key, nativeEvent, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

describe("mention composition keys (#757)", () => {
  it.each([{ isComposing: true }, { keyCode: 229 }])("skips editor shortcuts during composition (%j)", (composition) => {
    const onChange = vi.fn();
    const { getByRole } = render(createElement(MarkdownEditor, {
      value: "@a", onChange, users: [{ id: "ada", name: "Ada" }],
    }));
    const textarea = getByRole("textbox");
    fireEvent.keyDown(textarea, { key: " ", ctrlKey: true, ...composition });
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["Enter", "Tab", "ArrowDown", "ArrowUp", "Escape"])("leaves composing %s untouched", (key) => {
    const { result, onChange } = setup();
    const event = keyEvent(key, { isComposing: true });
    act(() => expect(result.current.handleKeyDown(event)).toBe(false));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.showSuggestions).toBe(true);
    expect(result.current.activeIndex).toBe(0);
  });

  it("also ignores the IME key code when isComposing is false", () => {
    const { result, onChange } = setup();
    const event = keyEvent("Enter", { isComposing: false, keyCode: 229 });
    act(() => expect(result.current.handleKeyDown(event)).toBe(false));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.showSuggestions).toBe(true);
  });

  it("keeps ordinary navigation and selection after composition", () => {
    const { result, onChange } = setup();
    act(() => result.current.handleKeyDown(keyEvent("Enter", { isComposing: true })));
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    expect(result.current.activeIndex).toBe(1);
    const event = keyEvent("Enter");
    act(() => expect(result.current.handleKeyDown(event)).toBe(true));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("@[Alan](alan) ");
    expect(result.current.showSuggestions).toBe(false);
  });
});

describe("mention span switching (#1171)", () => {
  function setupThree() {
    const onChange = vi.fn();
    const { result } = renderHook(() => useMentionSuggestions({
      users: [
        { id: "ada", name: "Ada" },
        { id: "alan", name: "Alan" },
        { id: "bob", name: "Bob" },
      ],
      value: "@a",
      onChange,
      textareaRef: { current: null },
    }));
    act(() => result.current.sync("@a", 2));
    return { result, onChange };
  }

  it("resets activeIndex when the mention query changes span", () => {
    const { result } = setupThree();
    // Highlight the second suggestion (Alan) for "@a".
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    expect(result.current.activeIndex).toBe(1);
    expect(result.current.suggestions).toHaveLength(2);

    // Move caret to a different mention span ("@b" -> only Bob matches).
    act(() => result.current.sync("@b", 2));
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.suggestions).toHaveLength(1);
  });

  it("resets activeIndex when same query appears at a different span start (#1171)", () => {
    const { result } = setupThree();
    // Highlight the second suggestion (Alan) for the first "@a".
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    expect(result.current.activeIndex).toBe(1);

    // Move caret to a second "@a" span: same query, different start position.
    act(() => result.current.sync("@a @a", 4));
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.showSuggestions).toBe(true);
  });

  it("inserts the clamped suggestion after moving spans", () => {
    const { result, onChange } = setupThree();
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    expect(result.current.activeIndex).toBe(1);

    act(() => result.current.sync("@b", 2));
    const event = keyEvent("Enter");
    act(() => expect(result.current.handleKeyDown(event)).toBe(true));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("@[Bob](bob) ");
    expect(result.current.showSuggestions).toBe(false);
  });

  it("clamps activeIndex when suggestions shrink below it", () => {
    const { result } = setupThree();
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    expect(result.current.activeIndex).toBe(1);

    act(() => result.current.sync("@z", 2));
    expect(result.current.suggestions).toHaveLength(0);
    expect(result.current.activeIndex).toBe(0);
  });
});

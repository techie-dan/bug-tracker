// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { labelContainedInName, labelInNameMismatches } from "./label-in-name";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("label in name (WCAG 2.5.3)", () => {
  it("fails when aria-label drops the visible word, as the points chip did", () => {
    const root = mount(`
      <a href="/users/ada" aria-label="0 points of 500. 0 solved.">
        <span>0</span>
        <span>pts</span>
        <span class="sr-only"> of 500, 0 solved</span>
      </a>
    `);
    expect(labelInNameMismatches(root)).toEqual([
      expect.objectContaining({
        name: "0 points of 500. 0 solved.",
        visible: "0 pts",
      }),
    ]);
  });

  it("passes when the visible word is part of the name", () => {
    const root = mount(`
      <a href="/users/ada">
        <span>128</span>
        <span>pts</span>
        <span class="sr-only"> of 500, 4 solved</span>
      </a>
    `);
    expect(labelInNameMismatches(root)).toEqual([]);
  });

  it("requires the visible words in order, as the upvote control did", () => {
    expect(labelContainedInName("Upvote 2", "Upvote this issue, 2 votes")).toBe(false);
    expect(labelContainedInName("Upvote 2", "Upvote 2 votes")).toBe(true);
  });

  it("ignores an icon control whose only name is the aria-label", () => {
    const root = mount(`
      <button type="button" aria-label="Open menu">
        <svg aria-hidden="true"></svg>
      </button>
    `);
    expect(labelInNameMismatches(root)).toEqual([]);
  });

  it("ignores a name that is not on a control", () => {
    const root = mount(`<span aria-label="5 pending">5</span>`);
    expect(labelInNameMismatches(root)).toEqual([]);
  });
});

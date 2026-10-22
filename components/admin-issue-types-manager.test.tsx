// @vitest-environment jsdom
"use client";

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminIssueTypesManager } from "./admin-issue-types-manager";

vi.mock("@/app/actions/issue-types", () => ({
  createIssueTypeAction: vi.fn(),
  updateIssueTypeAction: vi.fn(),
  toggleIssueTypeActiveAction: vi.fn(),
  deleteIssueTypeAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const types = [
  {
    id: "type-1",
    name: "Bug",
    description: "Something is broken",
    template: null,
    isActive: true,
    createdAt: new Date("2026-01-01"),
    _count: { bugs: 4 },
  },
];

describe("AdminIssueTypesManager action cluster (#694)", () => {
  it("wraps and right-aligns its actions like the platform manager", () => {
    render(<AdminIssueTypesManager types={types} />);
    const cluster = screen.getByRole("button", { name: "Delete" }).parentElement;
    expect(cluster).not.toBeNull();
    expect(cluster).toHaveClass("flex-wrap");
    expect(cluster).toHaveClass("justify-end");
  });

  it("gives actions a 44px mobile touch target that resets on desktop", () => {
    render(<AdminIssueTypesManager types={types} />);
    for (const name of ["Edit", "Deactivate", "Delete"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveClass("min-h-11");
      expect(button).toHaveClass("sm:min-h-0");
    }
  });
});

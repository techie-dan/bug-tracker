// @vitest-environment jsdom
"use client";

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryManager } from "./category-manager";

vi.mock("@/app/actions/categories", () => ({
  createCategoryAction: vi.fn(),
  updateCategoryAction: vi.fn(),
  toggleCategoryStatusAction: vi.fn(),
  deleteCategoryAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const categories = [
  {
    id: "cat-1",
    name: "Backend Services, APIs and Integrations",
    isActive: true,
    createdAt: new Date("2026-01-01"),
    _count: { bugs: 12 },
  },
];

/** The wrapper that holds a row's count + action buttons. */
function actionCluster(name: string): HTMLElement {
  const button = screen.getByRole("button", { name });
  const cluster = button.parentElement;
  if (!cluster) throw new Error(`no action cluster for ${name}`);
  return cluster;
}

describe("CategoryManager row reflow on 360px phones (#694)", () => {
  it("wraps the action cluster so the row can reflow instead of clipping Delete", () => {
    render(<CategoryManager initialCategories={categories} />);

    // The cluster that used to be `flex items-center gap-3` (no wrap) now
    // wraps, so a narrow card pushes the actions onto their own line rather
    // than overflowing the card's `overflow-hidden` and eating Delete.
    const cluster = actionCluster("Delete");
    expect(cluster).toHaveClass("flex-wrap");
    // Mobile-first: it only right-aligns from `sm` up, leaving the wrapped
    // mobile layout left-aligned.
    expect(cluster).toHaveClass("sm:justify-end");
    expect(cluster).not.toHaveClass("justify-end");
    expect(cluster).not.toHaveClass("flex-nowrap");
  });

  it("gives every row action a 44px touch target on phones, compact on desktop", () => {
    render(<CategoryManager initialCategories={categories} />);

    for (const name of ["Edit", "Deactivate", "Delete"]) {
      const button = screen.getByRole("button", { name });
      // 44px on phones (min-h-11) …
      expect(button).toHaveClass("min-h-11");
      // … reset to the compact height from `sm` up.
      expect(button).toHaveClass("sm:min-h-0");
      expect(button).toHaveClass("sm:px-2.5");
      expect(button).toHaveClass("sm:py-1");
    }
  });

  it("keeps the action cluster spaced with a small gap when it wraps", () => {
    render(<CategoryManager initialCategories={categories} />);
    expect(actionCluster("Delete")).toHaveClass("gap-2");
  });

  it("keeps the row-level wrapper able to wrap (never a fixed single row)", () => {
    const { container } = render(
      <CategoryManager initialCategories={categories} />,
    );
    const row = container.querySelector(".divide-y > div");
    expect(row).not.toBeNull();
    expect(row).toHaveClass("flex-wrap");
  });

  it("still renders the count and all three actions for a row", () => {
    render(<CategoryManager initialCategories={categories} />);
    expect(screen.getByText("12 issues")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});

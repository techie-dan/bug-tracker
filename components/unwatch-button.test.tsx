// @vitest-environment jsdom
"use client";

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnwatchButton } from "./unwatch-button";

vi.mock("@/app/actions/watch", () => ({
  setWatchingAction: vi.fn(),
  unwatchFinishedAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UnwatchButton touch target (#695)", () => {
  it("is a 44px target on phones and compact from sm up", () => {
    render(<UnwatchButton bugId="b1" label="END-1 Fix login" />);

    const button = screen.getByRole("button", { name: "Unwatch END-1 Fix login" });
    expect(button).toHaveClass("min-h-11");
    expect(button).toHaveClass("sm:min-h-0");
    expect(button).toHaveClass("sm:px-2.5");
    expect(button).toHaveClass("sm:py-1");
  });
});

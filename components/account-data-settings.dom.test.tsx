// @vitest-environment jsdom
"use client";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccountAction } from "@/app/actions/account";
import { AccountDataSettings } from "./account-data-settings";

vi.mock("@/app/actions/account", () => ({
  deleteAccountAction: vi.fn(),
}));

const mockedDeleteAccount = vi.mocked(deleteAccountAction);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AccountDataSettings (#571)", () => {
  beforeEach(() => {
    mockedDeleteAccount.mockReset();
    mockedDeleteAccount.mockResolvedValue({ ok: true });
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("renders download link and delete account button", () => {
    render(<AccountDataSettings />);

    const downloadLink = screen.getByRole("link", { name: /Download my data/i });
    expect(downloadLink).toBeDefined();
    expect(downloadLink.getAttribute("href")).toBe("/api/user/export");
    expect(downloadLink.hasAttribute("download")).toBe(true);

    const deleteButton = screen.getByRole("button", { name: /Delete account/i });
    expect(deleteButton).toBeDefined();
  });

  it("confirms before deleting account and calls deleteAccountAction", async () => {
    const confirm = vi.mocked(window.confirm);

    render(<AccountDataSettings />);
    const deleteButton = screen.getByRole("button", { name: /Delete account/i });
    fireEvent.click(deleteButton);

    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockedDeleteAccount).toHaveBeenCalled());
  });

  it("does not delete account when user cancels confirmation", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));

    render(<AccountDataSettings />);
    const deleteButton = screen.getByRole("button", { name: /Delete account/i });
    fireEvent.click(deleteButton);

    expect(mockedDeleteAccount).not.toHaveBeenCalled();
  });

  it("displays error message if deleteAccountAction returns an error", async () => {
    mockedDeleteAccount.mockResolvedValueOnce({
      ok: false,
      error: "Cannot delete account while you are the sole owner of a workspace.",
    });

    render(<AccountDataSettings />);
    const deleteButton = screen.getByRole("button", { name: /Delete account/i });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain(
        "Cannot delete account while you are the sole owner of a workspace.",
      );
    });
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  reEnable: vi.fn(),
}));
vi.mock("@/app/actions/webhooks", () => ({
  createWebhookAction: actions.create,
  deleteWebhookAction: actions.remove,
  listWebhooksAction: actions.list,
  reEnableWebhookAction: actions.reEnable,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => vi.fn(async () => true) }));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));

import { WebhookManagement } from "./webhook-management";

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("WebhookManagement", () => {
  it("shows a retryable error when the initial list action rejects", async () => {
    const user = userEvent.setup();
    actions.list
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({ ok: true, subscriptions: [], agents: [] });
    render(<WebhookManagement />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load webhook subscriptions");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Add webhook" })).toBeInTheDocument();
    expect(actions.list).toHaveBeenCalledTimes(2);
  });
});

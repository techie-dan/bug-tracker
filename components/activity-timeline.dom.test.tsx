// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityTimeline, type ActivityEntry } from "./activity-timeline";

let seq = 0;
function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  seq += 1;
  return {
    id: `activity-${seq}`,
    type: "commented",
    summary: "Left a note on the ticket",
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    actor: { name: "Alice" },
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("ActivityTimeline collapsed by default (#418)", () => {
  it("renders collapsed on first load and reports the full count, not the shown entries", () => {
    const { container } = render(
      <ActivityTimeline activities={[entry(), entry()]} totalCount={5} />,
    );

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    // The collapsed header uses the total on the issue (totalCount), so it
    // does not under-report when the timeline is truncated to the newest N.
    expect(screen.getByText("Activity (5)")).toBeInTheDocument();
    expect(screen.getByText(/Showing the 2 most recent of 5\./)).toBeInTheDocument();
    // Entries are in the tree, they are just hidden until the section opens.
    expect(details).toHaveTextContent("Left a note on the ticket");
  });

  it("expands through the header and exposes the unchanged timeline", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ActivityTimeline activities={[entry({ actor: { name: "Bob" } })]} totalCount={1} />,
    );

    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    expect(summary).not.toBeNull();

    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Bob")).toBeVisible();

    await user.click(summary);
    expect(details).not.toHaveAttribute("open");
  });

  it("keeps an issue without activity uncollapsed", () => {
    const { container } = render(
      <ActivityTimeline activities={[]} totalCount={0} />,
    );

    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("No activity recorded yet.")).toBeVisible();
  });
});

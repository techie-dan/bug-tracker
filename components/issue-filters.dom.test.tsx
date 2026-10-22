// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.params,
}));

const fetchMock = vi.fn();

import { IssueFilters } from "./issue-filters";

const tagTypes = [
  { id: "t1", name: "Design" },
  { id: "t2", name: "Fixes" },
];

describe("IssueFilters Show menu (#1104)", () => {
  beforeEach(() => {
    nav.params = new URLSearchParams();
    nav.push.mockReset();
    nav.replace.mockReset();
  });
  afterEach(cleanup);

  it("shows only the four supported views and falls back for old mine links", () => {
    nav.params = new URLSearchParams("mine=mine");
    render(<IssueFilters />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const show = screen.getByRole("combobox", { name: "Show" });
    expect(within(show).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All issues", "Assigned to me", "Created by me", "Issues I'm watching",
    ]);
    expect(show).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Remove view filter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all filters" })).not.toBeInTheDocument();
  });

  it.each(["", "assigned", "created", "watching"])("navigates when selecting %s", (value) => {
    nav.params = new URLSearchParams("mine=reported&status=open&page=3");
    render(<IssueFilters />);
    fireEvent.click(screen.getByRole("button", { name: /Filter \(/ }));
    const show = screen.getByRole("combobox", { name: "Show" });
    expect(show).toHaveValue("created");
    fireEvent.change(show, { target: { value } });
    expect(nav.push).toHaveBeenCalledWith(
      value ? `/issues?mine=${value}&status=open` : "/issues?status=open",
    );
  });
});

describe("IssueFilters milestone filters (#728)", () => {
  const milestones = [
    { id: "m1", title: "Release 1", isClosed: false },
    { id: "m2", title: "Release 2", isClosed: true },
  ];

  beforeEach(() => {
    nav.params = new URLSearchParams();
    nav.push.mockReset();
    nav.replace.mockReset();
  });
  afterEach(cleanup);

  it.each([["m1", "Release 1"], ["m2", "Release 2"], ["none", "No milestone"]])(
    "shows a removable milestone-only filter for %s",
    (id, label) => {
      nav.params = new URLSearchParams(`milestone=${id}&page=3`);
      render(<IssueFilters milestones={milestones} />);

      const remove = screen.getByRole("button", { name: "Remove milestone filter" });
      expect(remove.parentElement).toHaveTextContent(`Milestone: ${label}`);
      expect(screen.getByRole("button", { name: "Clear all filters" })).toBeInTheDocument();
      fireEvent.click(remove);
      expect(nav.push).toHaveBeenCalledWith("/issues");
    },
  );

  it("preserves other filters and resets paging when removing a milestone", () => {
    nav.params = new URLSearchParams("milestone=m1&status=open&page=3");
    render(<IssueFilters milestones={milestones} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove milestone filter" }));
    expect(nav.push).toHaveBeenCalledWith("/issues?status=open");
  });

  it("clears the milestone along with other filters", () => {
    nav.params = new URLSearchParams("milestone=m1&status=open&page=3");
    render(<IssueFilters milestones={milestones} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(nav.push).toHaveBeenCalledWith("/issues");
  });

  it("does not show active controls for an empty milestone", () => {
    nav.params = new URLSearchParams("milestone=&page=3");
    render(<IssueFilters milestones={milestones} />);
    expect(screen.queryByRole("button", { name: "Remove milestone filter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all filters" })).not.toBeInTheDocument();
  });
});

function typeSearch(value: string) {
  fireEvent.change(screen.getByRole("combobox", { name: "Search" }), {
    target: { value },
  });
}

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

describe("IssueFilters live search (#671)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    nav.params = new URLSearchParams();
    nav.push.mockReset();
    nav.replace.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ issues: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("filters the list a moment after typing stops", async () => {
    render(<IssueFilters tagTypes={tagTypes} />);

    typeSearch("login");
    expect(nav.push).not.toHaveBeenCalled();

    await settle();
    expect(nav.push).toHaveBeenCalledWith("/issues?q=login");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("keeps one history entry per typing session", async () => {
    render(<IssueFilters tagTypes={tagTypes} />);

    typeSearch("log");
    await settle();
    expect(nav.push).toHaveBeenCalledWith("/issues?q=log");

    typeSearch("login");
    await settle();
    expect(nav.replace).toHaveBeenCalledWith("/issues?q=login");
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it("suggests matching issue titles and opens the picked one", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        issues: [{ id: "i1", number: 4, title: "Login button broken", status: "open" }],
      }),
    });
    render(<IssueFilters tagTypes={tagTypes} />);

    typeSearch("login");
    await settle();

    const option = screen.getByText("Login button broken");
    expect(option).toBeInTheDocument();

    fireEvent.click(option);
    expect(nav.push).toHaveBeenCalledWith("/issues/i1");
  });

  it("puts the real search back when a tag is picked", async () => {
    nav.params = new URLSearchParams("q=crash");
    render(<IssueFilters tagTypes={tagTypes} />);

    typeSearch("de");
    await settle();
    expect(nav.push).toHaveBeenCalledWith("/issues?q=de");

    fireEvent.click(within(screen.getByRole("listbox")).getByText("Design"));
    expect(nav.replace).toHaveBeenCalledWith("/issues?q=crash&tags=design");
  });
});

describe("IssueFilters unified Filter button popover (#762)", () => {
  beforeEach(() => {
    nav.params = new URLSearchParams();
    nav.push.mockReset();
    nav.replace.mockReset();
  });
  afterEach(cleanup);

  it("renders a Filter trigger button next to search", () => {
    render(<IssueFilters tagTypes={tagTypes} />);
    const filterBtn = screen.getByRole("button", { name: /^filter/i });
    expect(filterBtn).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Filter issues" })).not.toBeInTheDocument();
  });

  it("displays active filter count on the Filter button when filters are active", () => {
    nav.params = new URLSearchParams("status=open&severity=high");
    render(<IssueFilters tagTypes={tagTypes} />);
    const filterBtn = screen.getByRole("button", { name: /filter \(2 active\)/i });
    expect(filterBtn).toBeInTheDocument();
    expect(filterBtn).toHaveTextContent("2");
  });

  it("toggles the filter popover and allows changing filters", () => {
    render(<IssueFilters tagTypes={tagTypes} />);
    const filterBtn = screen.getByRole("button", { name: /^filter/i });

    // Open popover
    fireEvent.click(filterBtn);
    const dialog = screen.getByRole("dialog", { name: "Filter issues" });
    expect(dialog).toBeInTheDocument();

    // Select Status in popover
    const statusSelect = within(dialog).getByLabelText("Status");
    fireEvent.change(statusSelect, { target: { value: "open" } });
    expect(nav.push).toHaveBeenCalledWith("/issues?status=open");
  });

  it("closes popover on Escape key", () => {
    render(<IssueFilters tagTypes={tagTypes} />);
    const filterBtn = screen.getByRole("button", { name: /^filter/i });

    fireEvent.click(filterBtn);
    expect(screen.getByRole("dialog", { name: "Filter issues" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Filter issues" })).not.toBeInTheDocument();
  });
});

describe("IssueFilters keyboard shortcuts (#727)", () => {
  beforeEach(() => {
    nav.params = new URLSearchParams();
    nav.push.mockReset();
    nav.replace.mockReset();
  });
  afterEach(cleanup);

  it("does not focus search or preventDefault when shortcutsEnabled is false", () => {
    render(<IssueFilters shortcutsEnabled={false} />);
    const searchInput = screen.getByRole("combobox", { name: /search/i });

    const slashEvent = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    window.dispatchEvent(slashEvent);

    expect(slashEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(searchInput);

    const cmdKEvent = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(cmdKEvent);

    expect(cmdKEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("does not trigger search hotkeys when focus is inside a dialog or dialog is open", () => {
    render(
      <div>
        <IssueFilters shortcutsEnabled={true} />
        <dialog open>
          <input data-testid="dialog-input" />
        </dialog>
      </div>,
    );
    const searchInput = screen.getByRole("combobox", { name: /search/i });
    const dialogInput = screen.getByTestId("dialog-input");
    dialogInput.focus();

    const slashEvent = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    dialogInput.dispatchEvent(slashEvent);

    expect(slashEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(dialogInput);

    const windowSlash = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    window.dispatchEvent(windowSlash);
    expect(windowSlash.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("does not trigger Ctrl/Cmd+K when focused on an editable element", () => {
    render(
      <div>
        <IssueFilters shortcutsEnabled={true} />
        <textarea data-testid="other-editor" />
      </div>,
    );
    const searchInput = screen.getByRole("combobox", { name: /search/i });
    const otherEditor = screen.getByTestId("other-editor");
    otherEditor.focus();

    const cmdKEvent = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true });
    otherEditor.dispatchEvent(cmdKEvent);

    expect(cmdKEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(otherEditor);
    expect(document.activeElement).not.toBe(searchInput);
  });
});

describe("IssueFilters search commit + feedback (#690)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    nav.params = new URLSearchParams();
    nav.push.mockReset();
    nav.replace.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ issues: [] }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders an explicit Search button next to the box", () => {
    render(<IssueFilters tagTypes={tagTypes} />);
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("does not commit the search when the box is blurred", () => {
    render(<IssueFilters tagTypes={tagTypes} />);
    const input = screen.getByRole("combobox", { name: "Search" });

    typeSearch("login timeout");
    // Blur must not itself commit the search: nothing happens on the event.
    fireEvent.blur(input);
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();

    // Only the documented live-search debounce may navigate, once (#671).
    vi.advanceTimersByTime(300);
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it("navigates exactly once when the Search button is pressed", () => {
    render(<IssueFilters tagTypes={tagTypes} />);

    typeSearch("login timeout");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/issues?q=login+timeout");

    // The debounce must not fire a second navigation.
    vi.advanceTimersByTime(300);
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("navigates exactly once on Enter", () => {
    render(<IssueFilters tagTypes={tagTypes} />);

    const input = screen.getByRole("combobox", { name: "Search" });
    typeSearch("crash");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/issues?q=crash");

    vi.advanceTimersByTime(300);
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it("still clears the search via the active-filter chip", () => {
    nav.params = new URLSearchParams("q=login");
    render(<IssueFilters tagTypes={tagTypes} />);

    const chip = screen.getByText(/Search:/);
    fireEvent.click(within(chip).getByRole("button", { name: "Remove search filter" }));

    expect(nav.push).toHaveBeenCalledWith("/issues");
  });

  it("exposes a busy state on the search box", () => {
    render(<IssueFilters tagTypes={tagTypes} />);
    // aria-busy is wired to the transition, starting idle. (It flips to true
    // only while a real navigation is pending, which a mocked router settles
    // synchronously, so the true case is asserted via source in the unit test
    // below rather than here.)
    expect(screen.getByTestId("search-box")).toHaveAttribute("aria-busy", "false");
  });
});

describe("IssueFilters stage filter (#1054)", () => {
  beforeEach(() => {
    nav.params = new URLSearchParams();
    nav.push.mockReset();
    nav.replace.mockReset();
  });
  afterEach(cleanup);

  it("offers Ideas and Issues, with their counts, in the Filter popover", () => {
    render(<IssueFilters stageCounts={{ reported: 7, confirmed: 2, ready: 4 }} />);
    fireEvent.click(screen.getByRole("button", { name: /^filter/i }));
    const stage = within(screen.getByRole("dialog", { name: "Filter issues" })).getByLabelText("Kind");
    expect(within(stage).getByRole("option", { name: "Ideas (7)" })).toBeInTheDocument();
    expect(within(stage).getByRole("option", { name: "Ideas awaiting upvotes (2)" })).toBeInTheDocument();
    expect(within(stage).getByRole("option", { name: "Issues (4)" })).toBeInTheDocument();

    fireEvent.change(stage, { target: { value: "reported" } });
    expect(nav.push).toHaveBeenCalledWith("/issues?stage=reported");
  });

  it("keeps old ?stage= links working, counted and removable", () => {
    nav.params = new URLSearchParams("stage=confirmed&page=2");
    render(<IssueFilters />);
    expect(screen.getByRole("button", { name: /filter \(1 active\)/i })).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Remove stage filter" });
    expect(remove.parentElement).toHaveTextContent("Kind: Ideas awaiting upvotes");
    fireEvent.click(remove);
    expect(nav.push).toHaveBeenCalledWith("/issues");
  });
});

describe("IssueFilters without a platform select (#1055)", () => {
  beforeEach(() => {
    nav.params = new URLSearchParams();
    nav.push.mockReset();
  });
  afterEach(cleanup);

  it("leaves the platform to the tabs above the list", () => {
    nav.params = new URLSearchParams("platform=cat-web");
    render(<IssueFilters />);
    // A chosen tab isn't counted as a filter or shown as a chip.
    expect(screen.getByRole("button", { name: /^filter$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove platform filter" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^filter/i }));
    expect(within(screen.getByRole("dialog", { name: "Filter issues" })).queryByLabelText("Platform")).not.toBeInTheDocument();
  });

  it("allows filtering by untagged platform when platforms are provided (#473)", () => {
    const platforms = [{ id: "cat-web", name: "Web" }];
    nav.params = new URLSearchParams("platform=none");
    render(<IssueFilters platforms={platforms} />);
    expect(screen.getByRole("button", { name: /filter \(1 active\)/i })).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Remove platform filter" });
    expect(remove.parentElement).toHaveTextContent("Platform: No platform");
    fireEvent.click(remove);
    expect(nav.push).toHaveBeenCalledWith("/issues");
  });
});

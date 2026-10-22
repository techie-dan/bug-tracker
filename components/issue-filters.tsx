"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { severities, statuses } from "@/lib/validations/issue";
import { severityLabel, statusLabel } from "@/lib/labels";
import { FINISHED_STATUS_FILTER } from "@/lib/issue-state";
import {
  BUG_SORT_OPTIONS,
  bugSortLabels,
  parseBugSort,
} from "@/lib/issues-sort";
import {
  TAGS_PARAM,
  parseTagFilter,
  serializeTags,
  suggestTags,
} from "@/lib/tag-filter";
import {
  MINE_FILTER_OPTIONS,
  mineFilterLabels,
  parseMineFilter,
  defaultSortFor,
} from "@/lib/mine-filter";
import {
  PLATFORM_NONE,
  PLATFORM_PARAM,
  parsePlatformFilter,
  platformChoices,
  type PlatformOption,
} from "@/lib/platform-filter";
import { AREA_NONE, AREA_PARAM, parseProjectAreaFilter, type ProjectAreaOption } from "@/lib/project-area-filter";
import { MILESTONE_NONE, MILESTONE_PARAM } from "@/lib/milestones";
import {
  MIN_SUGGEST_LENGTH,
  type IssueSuggestion,
} from "@/lib/issue-suggest";
import { isTypingTarget } from "@/lib/keyboard-shortcuts";

type TagType = { id: string; name: string; isActive?: boolean };

type Suggestion =
  | { kind: "tag"; id: string; name: string }
  | { kind: "issue"; id: string; number: number; title: string };

/** Long enough not to query on every keystroke, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * #1054: the intake stage used to be a sidebar beside the list. It is a
 * filter now, with the same `?stage=` values so old links keep working.
 * Ideas are reports that are not ready to pass on. Issues are.
 */
const STAGE_PARAM = "stage";
const STAGE_OPTIONS = [
  { value: "reported", label: "Ideas" },
  { value: "confirmed", label: "Ideas awaiting upvotes" },
  { value: "ready", label: "Issues" },
] as const;

/** URL params owned by the filter bar. `page` is paging, not a filter. */
const FILTER_PARAMS = [
  "q",
  STAGE_PARAM,
  TAGS_PARAM,
  "mine",
  "status",
  "severity",
  PLATFORM_PARAM,
  AREA_PARAM,
  "sort",
  MILESTONE_PARAM,
];

/** The issues URL with `changes` applied and paging reset. */
function hrefWithChanges(
  params: URLSearchParams,
  changes: Record<string, string>,
): string {
  const next = new URLSearchParams(params.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  next.delete("page");
  const qs = next.toString();
  return qs ? `/issues?${qs}` : "/issues";
}

export function IssueFilters({
  tagTypes = [],
  platforms = [],
  milestones = [],
  areas = [],
  shortcutsEnabled = true,
  stageCounts,
}: {
  tagTypes?: TagType[];
  platforms?: PlatformOption[];
  /** #289: open milestones first; closed ones stay selectable for history. */
  milestones?: { id: string; title: string; isClosed: boolean }[];
  areas?: ProjectAreaOption[];
  shortcutsEnabled?: boolean;
  /** Open issues in each intake stage, shown beside the Stage choices (#1054). */
  stageCounts?: { reported: number; confirmed: number; ready: number };
}) {
  const router = useRouter();
  const params = useSearchParams();
  // #690: while a navigation kicked off from this control is in flight, expose
  // a busy state so typing/searching gets visible + announced feedback.
  const [isSearching, startSearchTransition] = useTransition();
  const listId = useId();
  const filterPanelId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        filterPanelRef.current?.contains(target) ||
        filterButtonRef.current?.contains(target)
      ) {
        return;
      }
      setFilterOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFilterOpen(false);
        filterButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (!shortcutsEnabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      const isCmdOrCtrlK =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const isSlash =
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;

      if (!isCmdOrCtrlK && !isSlash) return;
      if (event.isComposing) return;

      const target = event.target as HTMLElement | null;
      const isEditable =
        isTypingTarget(target) ||
        Boolean(
          target &&
            (target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.tagName === "SELECT" ||
              target.isContentEditable ||
              Boolean(target.closest?.("[contenteditable='true']"))),
        );

      const inDialog =
        Boolean(target?.closest?.('dialog[open], [role="dialog"], [role="alertdialog"], [data-shortcuts-ignore]')) ||
        Boolean(document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]'));

      if (isSlash && isEditable) return;
      if (inDialog) return;
      if (isCmdOrCtrlK && isEditable) return;

      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcutsEnabled]);

  function updateMany(changes: Record<string, string>, replace = false) {
    // Nothing changed: don't navigate (and don't reset the page, #132).
    if (Object.entries(changes).every(([key, value]) => (params.get(key) ?? "") === value)) {
      return;
    }
    const href = hrefWithChanges(params, changes);
    startSearchTransition(() => {
      if (replace) router.replace(href);
      else router.push(href);
    });
  }

  function update(key: string, value: string) {
    updateMany({ [key]: value });
  }

  // Tag (issue type) filter from the search box (#102).
  const selectedTags = parseTagFilter(params.get(TAGS_PARAM), tagTypes);
  const selectedNames = selectedTags.map((t) => t.name);
  const currentQuery = params.get("q") ?? "";
  const [text, setText] = useState(currentQuery);
  // Follow the URL when it changes from outside (Back, a link), adjusting
  // state during render rather than in an effect.
  const [lastQuery, setLastQuery] = useState(currentQuery);
  if (currentQuery !== lastQuery) {
    setLastQuery(currentQuery);
    setText(currentQuery);
  }
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [issueSuggestions, setIssueSuggestions] = useState<IssueSuggestion[]>([]);
  const [suggestedFor, setSuggestedFor] = useState("");
  // Enter or the Search button applies the query at once; the debounced
  // navigation must not also fire and duplicate it (#690: leaving the box no
  // longer commits the search).
  const skipLiveRef = useRef<string | null>(null);
  // The real search before the current typing session. Picking a tag is a
  // filter choice, not text to search for, so it puts this back (#671).
  const queryBeforeEditingRef = useRef(currentQuery);
  // The first live update in a typing session pushes, so Back returns to the
  // search before it; later pauses replace that entry (#671).
  const livePushedRef = useRef(false);
  const paramsString = params.toString();

  // Filter the list a beat after typing stops.
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === currentQuery.trim()) {
      if (skipLiveRef.current === trimmed) skipLiveRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      if (skipLiveRef.current === trimmed) {
        skipLiveRef.current = null;
        return;
      }
      const href = hrefWithChanges(new URLSearchParams(paramsString), { q: trimmed });
      startSearchTransition(() => {
        if (livePushedRef.current) router.replace(href);
        else {
          livePushedRef.current = true;
          router.push(href);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, currentQuery, paramsString, router, startSearchTransition]);

  // Matching issue titles for the dropdown (#671), also debounced.
  useEffect(() => {
    const query = text.trim();
    // Suggestions already on screen are hidden by `suggestedFor` when they no
    // longer match, so there is nothing to clear here.
    if (!open || query.length < MIN_SUGGEST_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/issues/suggest?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { issues?: IssueSuggestion[] };
        setSuggestedFor(query);
        setIssueSuggestions(body.issues ?? []);
      } catch {
        // Aborted by the next keystroke, or offline: suggest nothing.
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, open]);

  // Only active types are suggested; inactive ones still work in a shared link.
  const tagSuggestions: Suggestion[] = open
    ? suggestTags(tagTypes.filter((t) => t.isActive !== false), text, selectedNames).map(
        (type) => ({ kind: "tag", id: type.id, name: type.name }),
      )
    : [];
  // Only results for the text in the box now; stale ones would mislead.
  const titleSuggestions: Suggestion[] =
    open && suggestedFor === text.trim()
      ? issueSuggestions.map((issue) => ({
          kind: "issue",
          id: issue.id,
          number: issue.number,
          title: issue.title,
        }))
      : [];
  const suggestions = [...tagSuggestions, ...titleSuggestions];

  function addTag(name: string) {
    // The typed text was only for finding the tag, so put the real search back.
    const restore = queryBeforeEditingRef.current;
    setText(restore);
    skipLiveRef.current = restore;
    setOpen(false);
    setActive(-1);
    // Replace a live-search entry still in history so it does not linger.
    updateMany(
      {
        [TAGS_PARAM]: serializeTags([...selectedNames, name]),
        q: restore,
      },
      livePushedRef.current,
    );
    livePushedRef.current = false;
  }

  function applyQueryNow() {
    const trimmed = text.trim();
    queryBeforeEditingRef.current = trimmed;
    if (trimmed !== currentQuery.trim()) skipLiveRef.current = trimmed;
    update("q", trimmed);
    livePushedRef.current = false;
  }

  function pickSuggestion(suggestion: Suggestion) {
    if (suggestion.kind === "tag") {
      addTag(suggestion.name);
      return;
    }
    setOpen(false);
    setActive(-1);
    router.push(`/issues/${suggestion.id}`);
  }

  function removeTag(name: string) {
    update(TAGS_PARAM, serializeTags(selectedNames.filter((n) => n !== name)));
  }

  /** Real link for each chip, so removing a tag also works before hydration. */
  function tagHref(name: string) {
    const next = new URLSearchParams(params.toString());
    const rest = serializeTags(selectedNames.filter((n) => n !== name));
    if (rest) next.set(TAGS_PARAM, rest);
    else next.delete(TAGS_PARAM);
    next.delete("page");
    const qs = next.toString();
    return qs ? `/issues?${qs}` : "/issues";
  }

  const currentSort = parseBugSort(
    params.get("sort"),
    defaultSortFor(parseMineFilter(params.get("mine"))),
  );
  const currentPlatform = parsePlatformFilter(params.get(PLATFORM_PARAM), platforms) ?? "";
  const platformOptions = platformChoices(platforms, currentPlatform || null);
  const currentArea = parseProjectAreaFilter(params.get(AREA_PARAM), areas) ?? "";
  const currentMine = parseMineFilter(params.get("mine")) ?? "";
  const currentMilestone = params.get(MILESTONE_PARAM) ?? "";

  const currentStage = STAGE_OPTIONS.find((option) => option.value === params.get(STAGE_PARAM))?.value ?? "";

  const activeFilterCount = [
    Boolean(currentStage),
    Boolean(params.get("status")),
    Boolean(params.get("severity")),
    Boolean(currentMine),
    selectedNames.length > 0,
    currentPlatform === PLATFORM_NONE,
    Boolean(currentArea),
    Boolean(currentMilestone),
    Boolean(params.get("sort")),
  ].filter(Boolean).length;

  // Only worth offering when there is something to clear (#336).
  const hasActiveFilters = FILTER_PARAMS.some((key) =>
    key === "mine" ? Boolean(currentMine) : (params.get(key) ?? "") !== "",
  );

  function clearAllFilters() {
    // Empty the box straight away: until the navigation lands, the local draft
    // would otherwise keep showing the text that was just cleared.
    skipLiveRef.current = "";
    livePushedRef.current = false;
    setText("");
    setOpen(false);
    setActive(-1);
    setFilterOpen(false);
    router.push("/issues");
  }

  const milestoneValue =
    milestones.some((m) => m.id === params.get(MILESTONE_PARAM)) ||
    params.get(MILESTONE_PARAM) === MILESTONE_NONE
      ? (params.get(MILESTONE_PARAM) ?? "")
      : "";

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="q" className="mb-1 block text-xs font-medium text-slate-600">
            Search
          </label>
          <div
            className="relative"
            aria-busy={isSearching}
            data-testid="search-box"
          >
            <input
              ref={inputRef}
              id="q"
              name="q"
              role="combobox"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
              aria-controls={suggestions.length > 0 ? listId : undefined}
              aria-activedescendant={active >= 0 && suggestions[active] ? `${listId}-${active}` : undefined}
              autoComplete="off"
              value={text}
              placeholder={
                shortcutsEnabled
                  ? "Search, or type a tag like Design (/)"
                  : "Search, or type a tag like Design"
              }
              className="w-full rounded-lg border border-slate-300 pl-3 pr-8 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              onChange={(event) => {
                setText(event.target.value);
                setOpen(true);
                setActive(-1);
              }}
              onFocus={() => {
                queryBeforeEditingRef.current = currentQuery;
                livePushedRef.current = false;
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && suggestions.length > 0) {
                  event.preventDefault();
                  setActive((i) => (i + 1) % suggestions.length);
                } else if (event.key === "ArrowUp" && suggestions.length > 0) {
                  event.preventDefault();
                  setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                } else if (event.key === "Escape") {
                  setOpen(false);
                  setActive(-1);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const picked = active >= 0 ? suggestions[active] : undefined;
                  if (picked) pickSuggestion(picked);
                  else applyQueryNow();
                } else if (event.key === "Backspace" && text === "" && selectedNames.length > 0) {
                  removeTag(selectedNames[selectedNames.length - 1]);
                }
              }}
              onBlur={() => {
                // #690: leaving the box must not commit the search — only
                // Enter, the Search button, or the debounce may navigate.
                setOpen(false);
                setActive(-1);
              }}
            />
            {!text && shortcutsEnabled ? (
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5">
                <kbd className="hidden sm:inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 select-none">
                  /
                </kbd>
              </div>
            ) : null}
            {suggestions.length > 0 ? (
              <ul
                id={listId}
                role="listbox"
                aria-label="Search suggestions"
                className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
              >
                {suggestions.map((suggestion, index) => (
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                  <li
                    key={`${suggestion.kind}-${suggestion.id}`}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pickSuggestion(suggestion)}
                    className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 ${
                      index === active ? "bg-teal-50 text-teal-900" : "text-slate-800"
                    }`}
                  >
                    {suggestion.kind === "tag" ? (
                      <>
                        <span className="font-medium">{suggestion.name}</span>
                        <span className="shrink-0 text-xs text-slate-500">Filter by tag</span>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 truncate">
                          <span className="tabular-nums text-slate-500">#{suggestion.number}</span>{" "}
                          {suggestion.title}
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">Open issue</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        {/* Explicit Search submit (#690): Enter also works, but a visible
            control makes the commit point obvious and keeps Tab-out inert. */}
        <button
          type="button"
          onClick={applyQueryNow}
          disabled={isSearching}
          className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-teal-700 bg-teal-700 px-3 text-sm font-medium text-white shadow-xs transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-70"
        >
          {isSearching ? (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
          )}
          <span>Search</span>
        </button>

        {/* Unified Filter Button & Popover (#762) */}
        <div className="relative shrink-0">
          <button
            ref={filterButtonRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            aria-controls={filterPanelId}
            aria-label={activeFilterCount > 0 ? `Filter (${activeFilterCount} active)` : "Filter"}
            onClick={() => setFilterOpen((prev) => !prev)}
            className={`inline-flex h-[38px] items-center gap-1.5 rounded-lg border px-3 text-sm font-medium shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${
              activeFilterCount > 0 || filterOpen
                ? "border-teal-600 bg-teal-50 text-teal-900 hover:bg-teal-100"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            <span>Filter</span>
            {activeFilterCount > 0 ? (
              <span
                aria-hidden="true"
                className="inline-flex items-center justify-center rounded-full bg-teal-700 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
              >
                {activeFilterCount}
              </span>
            ) : null}
            <svg
              className={`h-4 w-4 text-slate-500 transition-transform ${filterOpen ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {filterOpen ? (
            <div
              ref={filterPanelRef}
              id={filterPanelId}
              role="dialog"
              aria-label="Filter issues"
              className="absolute right-0 z-30 mt-2 w-[calc(100vw-2rem)] max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-xl ring-1 ring-black/5"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 text-sm">Filters</span>
                  {activeFilterCount > 0 ? (
                    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800">
                      {activeFilterCount} active
                    </span>
                  ) : null}
                </div>
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline"
                  >
                    Clear all
                  </button>
                ) : null}
              </div>

              <div className="mt-3 space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                {/* Show (Mine) */}
                <div>
                  <label htmlFor="mine" className="mb-1 block text-xs font-medium text-slate-600">
                    Show
                  </label>
                  <select
                    id="mine"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    value={currentMine === "reported" ? "created" : currentMine}
                    onChange={(event) => update("mine", event.target.value)}
                  >
                    <option value="">All issues</option>
                    {MINE_FILTER_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {mineFilterLabels[option]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Stage (#1054): was the sidebar beside the list. */}
                <div>
                  <label htmlFor="stage" className="mb-1 block text-xs font-medium text-slate-600">
                    Kind
                  </label>
                  <select
                    id="stage"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    value={currentStage}
                    onChange={(event) => update(STAGE_PARAM, event.target.value)}
                  >
                    <option value="">Ideas and issues</option>
                    {STAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {stageCounts ? `${option.label} (${stageCounts[option.value]})` : option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status */}
                <div>
                  <label htmlFor="status" className="mb-1 block text-xs font-medium text-slate-600">
                    Status
                  </label>
                  <select
                    id="status"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    value={params.get("status") ?? ""}
                    onChange={(event) => update("status", event.target.value)}
                  >
                    <option value="">All</option>
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel[status]}
                      </option>
                    ))}
                    {/* The stat grid's "Closed" tile counts resolved + closed together
                        (#685); the same aggregate is selectable here. */}
                    <option value={FINISHED_STATUS_FILTER}>Closed (incl. resolved)</option>
                  </select>
                </div>

                {/* Severity */}
                <div>
                  <label htmlFor="severity" className="mb-1 block text-xs font-medium text-slate-600">
                    Severity
                  </label>
                  <select
                    id="severity"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    value={params.get("severity") ?? ""}
                    onChange={(event) => update("severity", event.target.value)}
                  >
                    <option value="">All</option>
                    {severities.map((severity) => (
                      <option key={severity} value={severity}>
                        {severityLabel[severity]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Category */}
                <div>
                  <label htmlFor="category" className="mb-1 block text-xs font-medium text-slate-600">
                    Category
                  </label>
                  <select
                    id="category"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    value={selectedNames[0] ?? ""}
                    onChange={(event) => update(TAGS_PARAM, serializeTags([event.target.value]))}
                  >
                    <option value="">All</option>
                    {Array.from(
                      new Set([
                        "Features",
                        "Fixes",
                        "Design",
                        "Marketing",
                        "Documentation",
                        "Other",
                        ...tagTypes.filter((t) => t.isActive !== false).map((t) => t.name),
                      ]),
                    ).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Platform */}
                {platformOptions.length > 0 ? (
                  <div>
                    <label htmlFor="platform" className="mb-1 block text-xs font-medium text-slate-600">
                      Platform
                    </label>
                    <select
                      id="platform"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      value={currentPlatform}
                      onChange={(event) => update(PLATFORM_PARAM, event.target.value)}
                    >
                      <option value="">All</option>
                      {platformOptions.map((platform) => (
                        <option key={platform.id} value={platform.id}>
                          {platform.name}
                        </option>
                      ))}
                      <option value={PLATFORM_NONE}>No platform</option>
                    </select>
                  </div>
                ) : null}

                {/* Project area */}
                {areas.length > 0 ? (
                  <div>
                    <label htmlFor="area" className="mb-1 block text-xs font-medium text-slate-600">
                      Area
                    </label>
                    <select
                      id="area"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      value={currentArea}
                      onChange={(event) => update(AREA_PARAM, event.target.value)}
                    >
                      <option value="">All</option>
                      {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                      <option value={AREA_NONE}>No area</option>
                    </select>
                  </div>
                ) : null}

                {/* Milestone */}
                {milestones.length > 0 ? (
                  <div>
                    <label htmlFor="milestone" className="mb-1 block text-xs font-medium text-slate-600">
                      Milestone
                    </label>
                    <select
                      id="milestone"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      value={milestoneValue}
                      onChange={(event) => update(MILESTONE_PARAM, event.target.value)}
                    >
                      <option value="">All</option>
                      {milestones.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title}
                          {m.isClosed ? " (closed)" : ""}
                        </option>
                      ))}
                      <option value={MILESTONE_NONE}>No milestone</option>
                    </select>
                  </div>
                ) : null}

                {/* Sort */}
                <div>
                  <label htmlFor="sort" className="mb-1 block text-xs font-medium text-slate-600">
                    Sort By
                  </label>
                  <select
                    id="sort"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    value={currentSort}
                    onChange={(event) => update("sort", event.target.value)}
                  >
                    {BUG_SORT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {bugSortLabels[option]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Selected Tags below Search (combobox inline chips) */}
      {selectedTags.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Tag filters">
          {selectedTags.map((type) => (
            <li key={type.id}>
              <a
                href={tagHref(type.name)}
                onClick={(event) => {
                  event.preventDefault();
                  removeTag(type.name);
                }}
                aria-label={`Remove tag ${type.name}`}
                className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-teal-900 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              >
                {type.name}
                <span aria-hidden="true" className="text-teal-700">×</span>
              </a>
            </li>
          ))}
          {selectedTags.length > 1 ? (
            <li>
              <button
                type="button"
                onClick={() => update(TAGS_PARAM, "")}
                className="px-1 text-xs text-slate-500 hover:text-slate-800 hover:underline"
              >
                Clear tags
              </button>
            </li>
          ) : null}
        </ul>

      ) : null}

      {/* Active Filter Chips */}
      {hasActiveFilters ? (
        <div className="flex w-full flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <span className="text-xs font-medium text-slate-600">Active filters:</span>
          {currentQuery ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-teal-900">
              Search: &ldquo;{currentQuery}&rdquo;
              <button
                type="button"
                onClick={() => {
                  setText("");
                  update("q", "");
                }}
                aria-label="Remove search filter"
                className="ml-0.5 rounded-full p-0.5 text-teal-700 hover:bg-teal-200/60"
              >
                ✕
              </button>
            </span>
          ) : null}
          {currentStage ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-slate-800">
              Kind: {STAGE_OPTIONS.find((option) => option.value === currentStage)?.label}
              <button
                type="button"
                onClick={() => update(STAGE_PARAM, "")}
                aria-label="Remove stage filter"
                className="ml-0.5 rounded-full p-0.5 text-slate-600 hover:bg-slate-200/60"
              >
                ✕
              </button>
            </span>
          ) : null}
          {params.get("status") ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-emerald-900">
              Status:{" "}
              {params.get("status") === FINISHED_STATUS_FILTER
                ? "Closed (incl. resolved)"
                : statusLabel[params.get("status") as keyof typeof statusLabel] ?? params.get("status")}
              <button
                type="button"
                onClick={() => update("status", "")}
                aria-label="Remove status filter"
                className="ml-0.5 rounded-full p-0.5 text-emerald-700 hover:bg-emerald-200/60"
              >
                ✕
              </button>
            </span>
          ) : null}
          {params.get("severity") ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-amber-900">
              Severity: {severityLabel[params.get("severity") as keyof typeof severityLabel] ?? params.get("severity")}
              <button
                type="button"
                onClick={() => update("severity", "")}
                aria-label="Remove severity filter"
                className="ml-0.5 rounded-full p-0.5 text-amber-700 hover:bg-amber-200/60"
              >
                ✕
              </button>
            </span>
          ) : null}
          {selectedTags.map((type) => (
            <span
              key={type.id}
              className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-purple-900"
            >
              Category: {type.name}
              <button
                type="button"
                onClick={() => removeTag(type.name)}
                aria-label={`Remove tag ${type.name}`}
                className="ml-0.5 rounded-full p-0.5 text-purple-700 hover:bg-purple-200/60"
              >
                ✕
              </button>
            </span>
          ))}
          {currentPlatform === PLATFORM_NONE ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-sky-900">
              Platform: No platform
              <button
                type="button"
                onClick={() => update(PLATFORM_PARAM, "")}
                aria-label="Remove platform filter"
                className="ml-0.5 rounded-full p-0.5 text-sky-700 hover:bg-sky-200/60"
              >
                ✕
              </button>
            </span>
          ) : null}
          {currentArea ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-teal-900">
              Area: {currentArea === AREA_NONE ? "No area" : areas.find((area) => area.id === currentArea)?.name ?? currentArea}
              <button
                type="button"
                onClick={() => update(AREA_PARAM, "")}
                aria-label="Remove area filter"
                className="ml-0.5 rounded-full p-0.5 text-teal-700 hover:bg-teal-200/60"
              >
                ✕
              </button>
            </span>
          ) : null}
          {currentMilestone ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-indigo-900">
              Milestone: {currentMilestone === MILESTONE_NONE
                ? "No milestone"
                : milestones.find((milestone) => milestone.id === currentMilestone)?.title ?? currentMilestone}
              <button
                type="button"
                onClick={() => update(MILESTONE_PARAM, "")}
                aria-label="Remove milestone filter"
                className="ml-0.5 rounded-full p-0.5 text-indigo-700 hover:bg-indigo-200/60"
              >
                ✕
              </button>
            </span>
          ) : null}
          {currentMine ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-slate-800">
              View: {mineFilterLabels[currentMine as keyof typeof mineFilterLabels] ?? currentMine}
              <button
                type="button"
                onClick={() => update("mine", "")}
                aria-label="Remove view filter"
                className="ml-0.5 rounded-full p-0.5 text-slate-600 hover:bg-slate-200"
              >
                ✕
              </button>
            </span>
          ) : null}
          {params.get("sort") ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-slate-800">
              Sort: {bugSortLabels[currentSort]}
              <button
                type="button"
                onClick={() => update("sort", "")}
                aria-label="Remove sort filter"
                className="ml-0.5 rounded-full p-0.5 text-slate-600 hover:bg-slate-200"
              >
                ✕
              </button>
            </span>
          ) : null}
          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            Clear all filters
          </button>
        </div>
      ) : null}
    </div>
  );
}

export { IssueFilters as BugFilters };

"use client";

import { useId, useMemo, useRef, useState } from "react";
import { filterPeopleByName } from "@/lib/assignee-search";
import { Avatar } from "@/components/avatar";
import { formatUserLabel, type AppRole } from "@/lib/roles";

type Person = { id: string; name: string; role?: AppRole | null; image?: string | null };

type Option = { id: string; label: string; person?: Person };

const UNASSIGNED: Option = { id: "", label: "Unassigned" };

/**
 * Searchable assignee picker (#174). Type part of a name to filter the list;
 * the chosen person's id is submitted as a hidden `name` field, exactly like
 * the `<select>` it replaces, so server actions don't change.
 */
export function AssigneeCombobox({
  id,
  name,
  people,
  value,
  defaultValue = "",
  onChange,
  inputClassName = "",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  id: string;
  name: string;
  people: Person[];
  /** Controlled value; omit to let the component keep its own. */
  value?: string;
  defaultValue?: string;
  onChange?: (assigneeId: string) => void;
  inputClassName?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const listId = useId();
  const [ownValue, setOwnValue] = useState(defaultValue);
  const selectedId = value ?? ownValue;

  const labelFor = (personId: string) => {
    if (!personId) return UNASSIGNED.label;
    const person = people.find((p) => p.id === personId);
    return person ? formatUserLabel(person.name, person.role) : "";
  };

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const options: Option[] = useMemo(() => {
    const matches = filterPeopleByName(people, query).map((p) => ({
      id: p.id,
      label: formatUserLabel(p.name, p.role),
      person: p,
    }));
    // "Unassigned" stays available unless the person is clearly searching for someone.
    return query.trim() ? matches : [UNASSIGNED, ...matches];
  }, [people, query]);

  const openList = () => {
    if (open) return;
    setOpen(true);
    setQuery("");
    const current = [UNASSIGNED, ...people].findIndex((p) => p.id === selectedId);
    setActiveIndex(Math.max(0, current));
  };

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const choose = (option: Option) => {
    if (value === undefined) setOwnValue(option.id);
    onChange?.(option.id);
    close();
  };

  const moveTo = (index: number) => {
    if (options.length === 0) return;
    const next = (index + options.length) % options.length;
    setActiveIndex(next);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // An IME uses Enter and the arrow keys to commit or browse candidates.
    // Acting on them here would pick an assignee mid-composition (#483), so
    // leave every key alone until the composition ends. `keyCode === 229` is
    // the fallback browsers report when `isComposing` is already false.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) openList();
        else moveTo(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) openList();
        else moveTo(activeIndex - 1);
        break;
      case "Enter":
        if (open) {
          // Pick the highlighted person instead of submitting the form.
          event.preventDefault();
          const option = options[activeIndex];
          if (option) choose(option);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          close();
        }
        break;
      case "Tab":
        close();
        break;
    }
  };

  const activeOption = open ? options[activeIndex] : undefined;

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selectedId} />
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel ?? (ariaLabelledBy ? undefined : "Assignee")}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeOption ? `${listId}-${activeOption.id || "none"}` : undefined}
        placeholder={open ? "Search by name" : undefined}
        value={open ? query : labelFor(selectedId)}
        onFocus={openList}
        onClick={openList}
        onChange={(event) => {
          if (!open) setOpen(true);
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // Keep the list open while clicking an option in it.
          if (!listRef.current?.contains(event.relatedTarget as Node)) close();
        }}
        className={`w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm text-slate-900 shadow-xs placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 ${inputClassName}`}
      />
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z"
          clipRule="evenodd"
        />
      </svg>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Assignees"
          tabIndex={-1}
          className="absolute left-0 z-30 mt-1 max-h-64 w-full min-w-[14rem] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-slate-500" role="presentation">
              No people match “{query.trim()}”
            </li>
          ) : (
            options.map((option, index) => {
              const selected = option.id === selectedId;
              const active = index === activeIndex;
              return (
                // Options follow the aria-activedescendant combobox pattern:
                // the input owns Arrow/Enter handling, so the list items carry
                // no key handlers of their own (adding them would double-fire).
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={option.id || "none"}
                  id={`${listId}-${option.id || "none"}`}
                  data-index={index}
                  role="option"
                  aria-selected={selected}
                  // Keep focus in the input so typing keeps working.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${
                    active ? "bg-teal-50 text-teal-900" : "text-slate-800"
                  } ${option.id ? "" : "text-slate-500"}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.person ? (
                      <Avatar name={option.person.name} image={option.person.image} size="xs" />
                    ) : null}
                    <span className="truncate">{option.label}</span>
                  </span>
                  {selected ? (
                    <svg className="h-4 w-4 shrink-0 text-teal-700" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

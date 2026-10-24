"use client";

import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  filterUsersForMention,
  getMentionQuery,
  insertMention,
  type MentionQuery,
} from "@/lib/mentions";
import { applyTextChange } from "@/lib/editor-dom";

/** `agentOwner` marks an agent option (`id` is `agent:<id>`) and names its owner (#603). */
export type MentionUser = { id: string; name: string; agentOwner?: string };

/**
 * Shared @mention autocomplete state so every editor (bug description,
 * comments and replies) behaves the same.
 */
export function useMentionSuggestions({
  users,
  value,
  onChange,
  textareaRef,
  enabled = true,
}: {
  users: MentionUser[];
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  enabled?: boolean;
}) {
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(
    () => (mention ? filterUsersForMention(users, mention.query) : []),
    [mention, users],
  );

  const showSuggestions = enabled && mention !== null && suggestions.length > 0;

  /**
   * Re-evaluate the mention query at a caret position.
   *
   * #201: this used to reset `activeIndex` to 0 unconditionally. Because the
   * textarea calls `sync` from `onKeyUp`, `onClick` and `onSelect` as well as
   * `onChange`, pressing ArrowDown moved the highlight and the very next
   * keyup snapped it back, so Enter always inserted the first result.
   *
   * Callers should pass `resetIndex` only for genuine typing (onChange, or
   * inserting "@" from the toolbar) - never from keyup/click/select.
   */
  const sync = useCallback(
    (nextValue: string, caret: number, resetIndex = false) => {
      if (!enabled) return;
      setMention(getMentionQuery(nextValue, caret));
      if (resetIndex) setActiveIndex(0);
    },
    [enabled],
  );

  const close = useCallback(() => setMention(null), []);

  const apply = useCallback(
    (user: MentionUser) => {
      const textarea = textareaRef.current;
      if (!mention) return;
      const caret = textarea?.selectionStart ?? value.length;
      const next = insertMention(value, mention, caret, user.name, user.id);
      setMention(null);
      if (textarea) {
        applyTextChange(
          textarea,
          value,
          next.value,
          next.caret,
          next.caret,
          onChange,
        );
      } else {
        onChange(next.value);
      }
    },
    [mention, onChange, textareaRef, value],
  );

  /** Returns true when the key was consumed by the suggestion list. */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (
        !showSuggestions ||
        event.nativeEvent.isComposing ||
        event.nativeEvent.keyCode === 229
      ) return false;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (index) => (index - 1 + suggestions.length) % suggestions.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const user = suggestions[activeIndex];
        if (user) apply(user);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return true;
      }
      return false;
    },
    [activeIndex, apply, close, showSuggestions, suggestions],
  );

  return {
    mention,
    suggestions,
    activeIndex,
    showSuggestions,
    sync,
    close,
    apply,
    setActiveIndex,
    handleKeyDown,
  };
}

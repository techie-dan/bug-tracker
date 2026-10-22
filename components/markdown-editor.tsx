"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Textarea } from "@/components/ui/textarea";
import { CharacterCounter } from "@/components/ui/character-counter";
import { RichText } from "@/components/rich-text";
import {
  BoldIcon,
  BulletedListIcon,
  CodeBlockIcon,
  CodeIcon,
  EyeIcon,
  ItalicIcon,
  LinkIcon,
  MentionIcon,
  NumberedListIcon,
  QuoteIcon,
  StrikethroughIcon,
  TaskListIcon,
} from "@/components/editor-icons";
import { AgentMentionBadge } from "@/components/comment-body";
import {
  useMentionSuggestions,
  type MentionUser,
} from "@/components/use-mention-suggestions";
import { matchShortcut } from "@/lib/editor-shortcuts";
import { pasteToMarkdown } from "@/lib/markdown-paste";
import {
  applyFormat,
  isSelectionInList,
  type FormatAction,
} from "@/lib/markdown-toolbar";
import { applyTextChange } from "@/lib/editor-dom";
import { MAX_ATTACHMENT_BYTES, formatBytes } from "@/lib/attachments";
import {
  filesFrom,
  isFileDrag,
  markdownFor,
  nameForPasted,
  placeholderFor,
  replacePlaceholder,
} from "@/lib/editor-upload";

export type MarkdownEditorHandle = {
  focus: () => void;
  getTextarea: () => HTMLTextAreaElement | null;
};

type EditorTab = "write" | "preview";

type ToolbarButtonSpec = {
  action?: FormatAction;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  /** Only rendered in the Write tab (tab switches happen through the tabs). */
  tab?: EditorTab;
};

const WRITE_TOOLS: ToolbarButtonSpec[] = [
  // Bold: B glyph.
  { action: "bold", label: "Bold", icon: <BoldIcon /> },
  // Italic: slanted I glyph.
  { action: "italic", label: "Italic", icon: <ItalicIcon /> },
  // Strikethrough: S crossed by a horizontal line.
  { action: "strikethrough", label: "Strikethrough", icon: <StrikethroughIcon /> },
  // Heading levels use their explicit H1, H2, and H3 labels, so the visible
  // text stays inside the accessible name (WCAG 2.5.3).
  {
    action: "heading1",
    label: "H1",
    icon: <span className="text-xs font-bold leading-none">H1</span>,
  },
  {
    action: "heading2",
    label: "H2",
    icon: <span className="text-xs font-bold leading-none">H2</span>,
  },
  {
    action: "heading3",
    label: "H3",
    icon: <span className="text-xs font-bold leading-none">H3</span>,
  },
  // Quote: paired quotation marks.
  { action: "quote", label: "Quote", icon: <QuoteIcon /> },
  // Inline code: angle brackets.
  { action: "code", label: "Inline code", icon: <CodeIcon /> },
  // Code block: bordered block with angle brackets.
  { action: "codeBlock", label: "Code block", icon: <CodeBlockIcon /> },
  // Link: two connected loops.
  { action: "link", label: "Link", icon: <LinkIcon /> },
  // Bulleted list: dots with horizontal lines.
  { action: "ul", label: "Bulleted list", icon: <BulletedListIcon /> },
  // Numbered list: numerals with horizontal lines.
  { action: "ol", label: "Numbered list", icon: <NumberedListIcon /> },
  // Task list: checkboxes with horizontal lines.
  { action: "task", label: "Task list", icon: <TaskListIcon /> },
];

export type MarkdownEditorProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  rows?: number;
  /** Hint rendered under the editor. */
  footer?: ReactNode;
  /** Users offered by the @mention autocomplete. Omit to disable mentions. */
  users?: MentionUser[];
  /** Renders mention tags in the Preview tab. */
  renderMentions?: (text: string) => ReactNode;
  className?: string;
  "aria-label"?: string;
  /**
   * Id of the <label> for this field. The mention wrapper carries the
   * combobox role and needs a name of its own; pass this wherever the field
   * is named by a visible label rather than by `aria-label`.
   */
  labelId?: string;
  onUploadingChange?: (uploading: boolean) => void;
} & Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "children"
>;

function ToolbarButton({
  label,
  shortcut,
  disabled,
  icon,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      disabled={disabled}
      // Keep the textarea selection alive when the button is pressed. The
      // action itself runs on onClick so keyboard activation (Enter/Space
      // fire click, not mousedown) works too.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 sm:h-7 sm:w-7 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 sm:[@media(pointer:fine)]:h-7 sm:[@media(pointer:fine)]:w-7"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {icon}
      </span>
    </button>
  );
}

/**
 * GitHub-style Markdown editor: Write / Preview tabs, an icon toolbar, keyboard
 * shortcuts, @mentions and paste conversion. Content is stored as Markdown and
 * rendered through `RichText`, which never injects raw HTML.
 */
export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    id,
    name,
    value,
    onChange,
    placeholder,
    disabled = false,
    required,
    minLength,
    maxLength,
    rows = 6,
    footer,
    users,
    renderMentions,
    className = "",
    "aria-label": ariaLabel,
    onKeyDown,
    onKeyUp,
    onClick,
    onSelect,
    onPaste,
    onBlur,
    onInvalid,
    labelId,
    onUploadingChange,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const listboxId = `${fieldId}-mention-listbox`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<EditorTab>("write");
  // #305: uploads finish after the person has kept typing, so they patch
  // the latest text, not the text from when they started.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });
  const [uploading, setUploading] = useState(0);
  const onUploadingChangeRef = useRef(onUploadingChange);
  useEffect(() => {
    onUploadingChangeRef.current = onUploadingChange;
  });
  useEffect(() => {
    const isUploading = uploading > 0;
    onUploadingChangeRef.current?.(isUploading);
    return () => {
      if (isUploading) {
        onUploadingChangeRef.current?.(false);
      }
    };
  }, [uploading]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 2);
    setCanScrollRight(scrollWidth - clientWidth - scrollLeft > 2);
  }, []);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    checkScroll();
    const handleResize = () => checkScroll();
    window.addEventListener("resize", handleResize);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => checkScroll());
      ro.observe(el);
      return () => {
        window.removeEventListener("resize", handleResize);
        ro.disconnect();
      };
    }
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [checkScroll, users]);
  // `false` on the server so the first client render matches the server HTML.
  const isApple = useSyncExternalStore(
    subscribeToNothing,
    () => /mac|iphone|ipad|ipod/i.test(navigator.userAgent),
    () => false,
  );

  useImperativeHandle(ref, () => ({
    focus: () => {
      setTab("write");
      textareaRef.current?.focus();
    },
    getTextarea: () => textareaRef.current,
  }));

  const handleInvalid = (event: FormEvent<HTMLTextAreaElement>) => {
    if (tab !== "write") {
      event.preventDefault();
      setTab("write");
      const schedule =
        typeof requestAnimationFrame !== "undefined"
          ? requestAnimationFrame
          : (cb: () => void) => setTimeout(cb, 0);
      schedule(() => {
        textareaRef.current?.focus();
        textareaRef.current?.reportValidity?.();
      });
    }
    onInvalid?.(event);
  };

  const mention = useMentionSuggestions({
    users: users ?? [],
    value,
    onChange,
    textareaRef,
    enabled: Boolean(users?.length),
  });

  const closeMentions = mention.close;

  const applyAction = useCallback(
    (action: FormatAction) => {
      const textarea = textareaRef.current;
      if (!textarea || disabled) return;
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      const next = applyFormat(value, start, end, action);
      closeMentions();
      setTab("write");
      applyTextChange(
        textarea,
        value,
        next.value,
        next.selectionStart,
        next.selectionEnd,
        onChange,
      );
    },
    [closeMentions, disabled, onChange, value],
  );

  const insertAtCaret = useCallback(
    (text: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      const available = maxLength ? maxLength - (value.length - (end - start)) : text.length;
      const inserted = text.slice(0, Math.max(0, available));
      const next = value.slice(0, start) + inserted + value.slice(end);
      const caret = start + inserted.length;
      applyTextChange(textarea, value, next, caret, caret, onChange);
    },
    [maxLength, onChange, value],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      disabled ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    ) {
      onKeyDown?.(event);
      return;
    }

    if (mention.handleKeyDown(event)) {
      onKeyDown?.(event);
      return;
    }

    const textarea = event.currentTarget;

    // GitHub opens the mention picker with Ctrl/Cmd + Space.
    if ((event.metaKey || event.ctrlKey) && event.key === " ") {
      if (!users?.length) {
        onKeyDown?.(event);
        return;
      }
      event.preventDefault();
      const caret = textarea.selectionStart ?? 0;
      const next = `${value.slice(0, caret)}@${value.slice(caret)}`;
      applyTextChange(textarea, value, next, caret + 1, caret + 1, onChange);
      mention.sync(next, caret + 1, true);
      onKeyDown?.(event);
      return;
    }

    const match = matchShortcut(event, {
      inList: isSelectionInList(value, textarea.selectionStart, textarea.selectionEnd),
    });

    if (match) {
      // Unmatched keys (including Tab outside a list) keep the default behaviour.
      event.preventDefault();
      applyAction(match.action);
    }

    onKeyDown?.(event);
  };

  /**
   * #305: upload pasted or dropped files. A placeholder goes in at the caret
   * straight away and is swapped for the real Markdown, or removed with a
   * message if the upload fails, so no broken image is ever left behind.
   */
  const uploadFiles = (files: File[], pasted: boolean) => {
    if (files.length === 0 || disabled) return;
    setUploadError(null);
    const tooLarge = files.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooLarge.length) {
      setUploadError(
        tooLarge
          .map(
            (file) =>
              `${file.name}: ${formatBytes(file.size)} is over the ${formatBytes(MAX_ATTACHMENT_BYTES)} limit`,
          )
          .join(" "),
      );
    }
    const valid = files.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
    if (valid.length === 0) return;
    const jobs = valid.map((file) => ({
      file,
      name: pasted ? nameForPasted(file) : file.name,
      token: Math.random().toString(36).slice(2, 10),
    }));
    const textarea = textareaRef.current;
    // Each file on its own line, like GitHub, so two never run together.
    const caret = textarea?.selectionStart ?? value.length;
    const before = caret > 0 && value[caret - 1] !== "\n" ? "\n" : "";
    const text = before + jobs.map((j) => placeholderFor(j.token, j.name)).join("\n");
    const selected = textarea ? (textarea.selectionEnd ?? 0) - (textarea.selectionStart ?? 0) : 0;
    if (maxLength && value.length - selected + text.length > maxLength) {
      setUploadError("There isn't room left in this field for another file.");
      return;
    }
    setTab("write");
    insertAtCaret(text);

    for (const job of jobs) {
      setUploading((n) => n + 1);
      const body = new FormData();
      body.set("file", job.file, job.name);
      void fetch("/api/uploads", { method: "POST", body })
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as {
            id?: string;
            filename?: string;
            contentType?: string;
            error?: string;
          };
          if (!res.ok || !data.id) throw new Error(data.error || "The upload failed. Try again.");
          return markdownFor(
            { filename: data.filename ?? job.name, contentType: data.contentType ?? job.file.type },
            data.id,
          );
        })
        .then(
          (markdown) => ({ markdown, error: null as string | null }),
          (error: unknown) => ({
            markdown: "",
            error: `${job.name}: ${error instanceof Error ? error.message : "The upload failed."}`,
          }),
        )
        .then(({ markdown, error }) => {
          const current = valueRef.current;
          let next = replacePlaceholder(current, job.token, markdown);
          // #732: the finished Markdown (attachment URL included) is longer
          // than the placeholder it replaced, so the insert-time check above
          // can pass and the field still land over its limit. Never go over
          // silently: drop the swap the way a failed upload is dropped, and
          // say why, so the field stays valid and room can be made to try
          // the upload again.
          if (next !== null && maxLength !== undefined && next.length > maxLength) {
            setUploadError(
              `${job.name}: there isn't room left in this field for the finished upload. Remove something and try again.`,
            );
            next = replacePlaceholder(current, job.token, "");
          }
          if (next !== null) {
            valueRef.current = next;
            onChangeRef.current(next);
          }
          if (error) setUploadError(error);
          setUploading((n) => n - 1);
        });
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer?.types)) return;
    // Without this the browser opens the dropped file and the draft is lost.
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    if (!disabled) setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const to = event.relatedTarget as Node | null;
    if (!to || !event.currentTarget.contains(to)) setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    textareaRef.current?.focus();
    uploadFiles(filesFrom(event.dataTransfer), false);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    onPaste?.(event);
    if (disabled) return;
    const clipboard = event.clipboardData;
    if (!clipboard) return;

    // A screenshot (or a file copied in the file manager) comes as files;
    // that wins over any text/HTML description of it.
    const files = filesFrom(clipboard);
    if (files.length > 0) {
      event.preventDefault();
      uploadFiles(files, true);
      return;
    }

    const markdown = pasteToMarkdown({
      text: clipboard.getData("text/plain"),
      html: clipboard.getData("text/html"),
    });
    if (!markdown) return;

    event.preventDefault();
    insertAtCaret(markdown.replace(/\n$/, ""));
  };

  const hasContent = value.trim().length > 0;
  const writing = tab === "write";

  return (
    <div className="space-y-1.5">
      {/* #200: `overflow-hidden` on this shell clipped the absolutely-positioned
          mention listbox, which sits directly below the textarea and so
          rendered outside the shell - typing "@a" showed no dropdown at all.
          The shell must not clip. Rounded corners are preserved by clipping
          the toolbar row itself, which is the only child that needs it. */}
      <div
        className={`rounded-lg border bg-white shadow-sm focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/20 ${
          dragging ? "border-teal-600 ring-2 ring-teal-600/30" : "border-slate-300"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex flex-nowrap items-center gap-1 overflow-hidden rounded-t-lg border-b border-slate-200 bg-slate-50 px-1.5 py-1 sm:flex-wrap">
          <div
            className="flex shrink-0 items-center gap-1 border-r border-slate-200 pr-1.5"
            role="group"
            aria-label="Editor view"
          >
            <TabButton
              active={writing}
              disabled={disabled}
              onClick={() => setTab("write")}
            >
              Write
            </TabButton>
            <TabButton
              active={!writing}
              disabled={disabled || !hasContent}
              title={hasContent ? undefined : "Nothing to preview yet"}
              onClick={() => setTab("preview")}
              icon={<EyeIcon className="h-3.5 w-3.5" />}
            >
              Preview
            </TabButton>
          </div>

          <div className="relative min-w-0 flex-1 sm:flex-initial">
            <div
              ref={toolbarRef}
              onScroll={checkScroll}
              onFocus={checkScroll}
              className="flex flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:gap-0.5 sm:overflow-visible"
              role="toolbar"
              aria-label="Formatting"
            >
              {WRITE_TOOLS.map((tool) => (
                <ToolbarButton
                  key={tool.label}
                  label={tool.label}
                  shortcut={shortcutLabelFor(tool.action, isApple)}
                  disabled={disabled}
                  icon={tool.icon}
                  onClick={() => applyAction(tool.action as FormatAction)}
                />
              ))}
              {/* Mention: @ inside a speech bubble. */}
              {users?.length ? (
                <ToolbarButton
                  label="Mention"
                  shortcut={`${isApple ? "⌘" : "Ctrl+"}Space`}
                  disabled={disabled}
                  icon={<MentionIcon />}
                  onClick={() => insertAtCaret("@")}
                />
              ) : null}
            </div>
            {canScrollLeft && (
              <div
                aria-hidden="true"
                data-testid="fade-cue-left"
                className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-slate-50 to-transparent sm:hidden"
              />
            )}
            {canScrollRight && (
              <div
                aria-hidden="true"
                data-testid="fade-cue-right"
                className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-slate-50 to-transparent sm:hidden"
              />
            )}
          </div>
        </div>

        {/*
          ARIA allows role="combobox" on an input, not on a textarea — axe
          reports it as aria-allowed-role, and the role is simply ignored.
          The wrapper carries the combobox semantics instead (the ARIA 1.1
          pattern, which is what a multi-line autocomplete has to use), while
          the textarea keeps the attributes that belong to the text field.
        */}
        <div
          className={writing ? "relative" : "hidden"}
          role={users?.length ? "combobox" : undefined}
          // The wrapper owns the combobox role, so it needs the same name the
          // field has, or it is an unnamed widget (axe: aria-input-field-name).
          aria-label={users?.length ? ariaLabel : undefined}
          aria-labelledby={users?.length && !ariaLabel ? labelId : undefined}
          aria-haspopup={users?.length ? "listbox" : undefined}
          aria-owns={
            users?.length && mention.showSuggestions ? listboxId : undefined
          }
          aria-expanded={users?.length ? mention.showSuggestions : undefined}
        >
          <Textarea
            {...rest}
            ref={textareaRef}
            id={fieldId}
            name={name}
            value={value}
            required={required}
            minLength={minLength}
            maxLength={maxLength}
            rows={rows}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className={`rounded-b-lg rounded-t-none border-0 shadow-none focus:border-transparent focus:ring-0 ${className}`}
            onChange={(event) => {
              const next = event.target.value;
              onChange(next);
              // #201: only real typing resets the highlighted suggestion.
              mention.sync(
                next,
                event.target.selectionStart ?? next.length,
                true,
              );
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={(event) => {
              mention.sync(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? 0,
              );
              onKeyUp?.(event);
            }}
            onClick={(event: MouseEvent<HTMLTextAreaElement>) => {
              mention.sync(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? 0,
              );
              onClick?.(event);
            }}
            onSelect={(event) => {
              mention.sync(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? 0,
              );
              onSelect?.(event);
            }}
            onBlur={(event) => {
              mention.close();
              onBlur?.(event);
            }}
            onInvalid={handleInvalid}
            onPaste={handlePaste}
            aria-autocomplete={users?.length ? "list" : undefined}
            aria-controls={
              users?.length && mention.showSuggestions ? listboxId : undefined
            }
            aria-activedescendant={
              users?.length && mention.showSuggestions
                ? `${listboxId}-option-${mention.activeIndex}`
                : undefined
            }
          />
          {mention.showSuggestions ? (
            <MentionList
              listboxId={listboxId}
              suggestions={mention.suggestions}
              activeIndex={mention.activeIndex}
              onHover={mention.setActiveIndex}
              onSelect={mention.apply}
            />
          ) : null}
        </div>
        {!writing ? (
          <div className="max-h-96 overflow-y-auto rounded-b-lg px-3 py-2">
            <RichText
              content={value}
              className="mt-0"
              renderMentions={renderMentions}
            />
          </div>
        ) : null}
      </div>

      {uploadError ? (
        <div role="alert" className="flex items-start justify-between gap-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
          <span>{uploadError}</span>
          <button
            type="button"
            className="shrink-0 font-medium underline-offset-2 hover:underline"
            onClick={() => setUploadError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <p aria-live="polite" className="text-xs text-slate-500 empty:hidden">
        {uploading > 0 ? `Uploading ${uploading} file${uploading === 1 ? "" : "s"}…` : ""}
      </p>

      <div className="flex flex-wrap items-start justify-between gap-2">
        {footer}
        {maxLength ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!disabled ? <span className="text-xs text-slate-500">Paste or drop images · </span> : null}
            <CharacterCounter
              length={value.length}
              max={maxLength}
              className="shrink-0"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
});

function subscribeToNothing() {
  return () => {};
}

function TabButton({
  active,
  disabled,
  title,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  icon?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1 rounded px-2.5 py-1.5 sm:px-2 sm:py-1 text-xs font-medium transition ${
        active
          ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-300"
          : "text-slate-600 hover:text-slate-900"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
      {icon}
    </button>
  );
}

function MentionList({
  listboxId,
  suggestions,
  activeIndex,
  onHover,
  onSelect,
}: {
  listboxId: string;
  suggestions: MentionUser[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (user: MentionUser) => void;
}) {
  return (
    <ul
      id={listboxId}
      role="listbox"
      className="absolute left-0 top-full z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
    >
      {suggestions.map((user, index) => {
        const active = index === activeIndex;
        return (
          <li key={user.id} role="option" aria-selected={active}>
            <button
              id={`${listboxId}-option-${index}`}
              type="button"
              tabIndex={-1}
              className={`flex w-full px-3 py-2 text-left text-sm ${
                active
                  ? "bg-teal-50 text-teal-900"
                  : "text-slate-800 hover:bg-slate-50"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(user);
              }}
              onMouseEnter={() => onHover(index)}
            >
              {user.agentOwner ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{user.name}</span>
                  <AgentMentionBadge />
                  <span className="truncate text-slate-500">· {user.agentOwner}</span>
                </span>
              ) : (
                user.name
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const SHORTCUT_KEYS: Partial<Record<FormatAction, { key: string; shift?: boolean }>> = {
  bold: { key: "b" },
  italic: { key: "i" },
  strikethrough: { key: "x", shift: true },
  code: { key: "e" },
  codeBlock: { key: "e", shift: true },
  link: { key: "k" },
  ul: { key: "8", shift: true },
  ol: { key: "7", shift: true },
  task: { key: "9", shift: true },
  quote: { key: ".", shift: true },
  heading1: { key: "1", shift: true },
  heading2: { key: "2", shift: true },
  heading3: { key: "3", shift: true },
};

function shortcutFor(action: FormatAction | undefined) {
  if (!action) return undefined;
  return SHORTCUT_KEYS[action];
}

function shortcutLabelFor(action: FormatAction | undefined, isApple: boolean) {
  const combo = shortcutFor(action);
  if (!combo) return undefined;
  const mod = isApple ? "⌘" : "Ctrl";
  return `${mod}${combo.shift ? (isApple ? "⇧" : "+Shift+") : isApple ? "" : "+"}${combo.key.toUpperCase()}`;
}

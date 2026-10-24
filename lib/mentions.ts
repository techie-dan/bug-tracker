/**
 * Soft @mentions stored in comment bodies as `@[Display Name](userId)`.
 * Agents are mentioned as `@[Agent Name](agent:<agentId>)` (#603) so the
 * same tag shape can address a person or one of their agents.
 */

export type MentionToken =
  | { type: "text"; value: string }
  | { type: "mention"; name: string; userId: string };

/** Matches a complete soft-mention tag. */
export const MENTION_TAG_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Id prefix that marks a mention tag as addressing an agent, not a user (#603). */
export const AGENT_MENTION_PREFIX = "agent:";

/** The id an agent's mention tag carries, e.g. `agent:clx123`. */
export function agentMentionId(agentId: string): string {
  return `${AGENT_MENTION_PREFIX}${agentId}`;
}

/** The agent id behind an `agent:<id>` mention id, or null for a user id. */
export function parseAgentMentionId(id: string): string | null {
  if (!id.startsWith(AGENT_MENTION_PREFIX)) return null;
  const agentId = id.slice(AGENT_MENTION_PREFIX.length).trim();
  return agentId || null;
}

export function formatMention(name: string, userId: string): string {
  const safeName = name.replace(/[\[\]]/g, "").trim() || "user";
  return `@[${safeName}](${userId})`;
}

/**
 * Split comment text into verbatim code segments (fenced blocks and inline
 * code runs) and prose, so mention processing can skip code (#731) exactly
 * like mention autocomplete does (`getMentionQuery`).
 */
type CodeSegment = { code: boolean; value: string };

function backtickRun(body: string, i: number): number {
  let end = i;
  while (end < body.length && body[end] === "`") end += 1;
  return end - i;
}

/** First start index >= from of a backtick run of exactly `runLength`. */
function findInlineClose(body: string, from: number, runLength: number): number {
  let i = from;
  while (i < body.length) {
    if (body[i] === "`") {
      const run = backtickRun(body, i);
      if (run === runLength) return i;
      i += Math.max(run, 1);
    } else {
      i += 1;
    }
  }
  return -1;
}

/** A fence opens at `i` when a ```` ``` ```` / `~~~` run sits at a line start. */
function fenceAt(body: string, i: number): { marker: string; lineStart: number } | null {
  const lineStart = body.lastIndexOf("\n", i - 1) + 1;
  if (i - lineStart > 3) return null;
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(body.slice(lineStart));
  if (!match) return null;
  // The walker arrives at the first marking character (after any indents).
  if (body[i] !== match[1]![0]) return null;
  return { marker: match[1]!, lineStart };
}

/** Index after the closing fence line (or EOF when unterminated). */
function findFenceEnd(body: string, openStart: number, marker: string): number {
  let pos = openStart + marker.length;
  while (pos < body.length) {
    const lineEnd = body.indexOf("\n", pos);
    if (lineEnd === -1) {
      // Last, newline-less line: it may still be the closing fence.
      if (/^ {0,3}(`{3,}|~{3,})/.test(body.slice(pos)) === false) return body.length;
      return body.length;
    }
    const nextStart = lineEnd + 1;
    const close = /^ {0,3}(`{3,}|~{3,})/.exec(body.slice(nextStart));
    if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) {
      const closeLineEnd = body.indexOf("\n", nextStart);
      return closeLineEnd === -1 ? body.length : closeLineEnd + 1;
    }
    pos = nextStart;
  }
  return body.length;
}

function splitCodeSegments(body: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  let prose = "";
  let i = 0;
  const flushProse = () => {
    if (prose) {
      segments.push({ code: false, value: prose });
      prose = "";
    }
  };

  while (i < body.length) {
    if (body[i] === "`") {
      const run = backtickRun(body, i);
      const close = findInlineClose(body, i + run, run);
      if (close !== -1) {
        flushProse();
        const closeEnd = close + run;
        segments.push({ code: true, value: body.slice(i, closeEnd) });
        i = closeEnd;
        continue;
      }
      // Unmatched backtick run: treat as inline code to the end of the string,
      // matching the editor's autocomplete rule (odd backticks suppress @).
      flushProse();
      segments.push({ code: true, value: body.slice(i) });
      i = body.length;
      continue;
    }
    const fence = fenceAt(body, i);
    if (fence) {
      flushProse();
      const end = findFenceEnd(body, i, fence.marker);
      segments.push({ code: true, value: body.slice(i, end) });
      i = end;
      continue;
    }
    prose += body[i]!;
    i += 1;
  }
  flushProse();
  return segments;
}

function replaceMentionTags(
  text: string,
  getName: (id: string) => string | undefined,
): string {
  const re = new RegExp(MENTION_TAG_RE.source, "g");
  return text.replace(re, (_match, typedName: string, userId: string) => {
    const trimmedId = String(userId).trim();
    const realName = getName(trimmedId);
    if (!realName) {
      return `@${String(typedName).trim()}`;
    }
    return formatMention(realName, trimmedId);
  });
}

/** Unique ids (user or `agent:<id>`) in well-formed prose mention tags. */
function extractMentionIds(body: string): string[] {
  const ids = new Set<string>();
  for (const segment of splitCodeSegments(body)) {
    if (segment.code) continue;
    for (const match of segment.value.matchAll(MENTION_TAG_RE)) {
      const id = match[2]?.trim();
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/** Unique user ids referenced by well-formed prose mention tags in `body`.
 *  Mention tags inside fenced or inline code are excluded (#731), and so are
 *  agent mentions (#603). */
export function extractMentionedUserIds(body: string): string[] {
  return extractMentionIds(body).filter((id) => parseAgentMentionId(id) === null);
}

/** Unique agent ids referenced by `@[Name](agent:<id>)` prose tags (#603). */
export function extractMentionedAgentIds(body: string): string[] {
  const ids = new Set<string>();
  for (const id of extractMentionIds(body)) {
    const agentId = parseAgentMentionId(id);
    if (agentId) ids.add(agentId);
  }
  return [...ids];
}

/**
 * User ids mentioned in `nextBody` but not in `previousBody`, so an edit
 * only notifies people it newly tags instead of re-emailing everyone (#228).
 */
export function newlyMentionedUserIds(
  previousBody: string,
  nextBody: string,
): string[] {
  const before = new Set(extractMentionedUserIds(previousBody));
  return extractMentionedUserIds(nextBody).filter((id) => !before.has(id));
}

/** Agent ids mentioned in `nextBody` but not in `previousBody` (#603). */
export function newlyMentionedAgentIds(
  previousBody: string,
  nextBody: string,
): string[] {
  const before = new Set(extractMentionedAgentIds(previousBody));
  return extractMentionedAgentIds(nextBody).filter((id) => !before.has(id));
}

/**
 * Verifies mentions against known users.
 * Replaces unknown user IDs with plain text `@name`.
 * Canonicalizes known user mentions to their real name from the database.
 * Agent tags are kept only when `userMap` has their `agent:<id>` key (#603).
 */
export function normalizeMentions(
  body: string,
  userMap: Map<string, string> | Record<string, string>,
): string {
  const getName = (id: string) =>
    userMap instanceof Map ? userMap.get(id) : userMap[id];

  // Code segments stay verbatim; prose mentions are canonicalized (#731).
  return splitCodeSegments(body)
    .map((segment) =>
      segment.code ? segment.value : replaceMentionTags(segment.value, getName),
    )
    .join("");
}

/**
 * Split comment text into plain segments and mention tags.
 * Malformed `@…` sequences stay in text tokens and never throw.
 */
export function tokenizeMentions(body: string): MentionToken[] {
  if (!body) return [{ type: "text", value: "" }];

  const tokens: MentionToken[] = [];
  let lastIndex = 0;
  const re = new RegExp(MENTION_TAG_RE.source, "g");

  for (const match of body.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ type: "text", value: body.slice(lastIndex, index) });
    }
    const name = match[1]?.trim() ?? "";
    const userId = match[2]?.trim() ?? "";
    if (name && userId) {
      tokens.push({ type: "mention", name, userId });
    } else {
      tokens.push({ type: "text", value: match[0] });
    }
    lastIndex = index + match[0].length;
  }

  if (lastIndex < body.length) {
    tokens.push({ type: "text", value: body.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ type: "text", value: body }];
}

export type MentionQuery = {
  /** Index of the triggering `@` in the full string. */
  start: number;
  /** Text after `@` up to the caret (no spaces). */
  query: string;
};

/**
 * Detect an open @mention query at `caret`. Returns null when the caret is
 * not inside a mention draft (including inside a completed `@[…](…)` tag,
 * inside a fenced code block, or inside inline code).
 */
export function getMentionQuery(
  value: string,
  caret: number,
): MentionQuery | null {
  if (caret < 0 || caret > value.length) return null;
  if (isInsideCode(value, caret)) return null;

  const before = value.slice(0, caret);
  const match = before.match(/(^|[\s])@([^\s@[\]]*)$/);
  if (!match) return null;

  const query = match[2] ?? "";
  const start = caret - query.length - 1;
  return { start, query };
}

/** True when `caret` sits inside a fenced or inline code span. */
function isInsideCode(value: string, caret: number): boolean {
  const before = value.slice(0, caret);
  const fence = before.match(/```[\s\S]*?(?:```|$)/g)?.pop();
  if (fence && fence.startsWith("```") && !fence.endsWith("```")) return true;
  return (before.match(/`/g)?.length ?? 0) % 2 === 1;
}

export function filterUsersForMention<T extends { name: string }>(
  users: T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? users.filter((user) => user.name.toLowerCase().includes(q))
    : users;
  return filtered.slice(0, limit);
}

/** Replace the open `@query` at `mention.start` with a formatted mention tag. */
export function insertMention(
  value: string,
  mention: MentionQuery,
  caret: number,
  name: string,
  userId: string,
): { value: string; caret: number } {
  const tag = formatMention(name, userId);
  const before = value.slice(0, mention.start);
  const after = value.slice(caret);
  const next = `${before}${tag} ${after}`;
  return { value: next, caret: before.length + tag.length + 1 };
}

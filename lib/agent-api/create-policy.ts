import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  fallbackTerms,
  normalizeQuery,
  pickSimilar,
  shouldSearch,
  SIMILAR_LIMIT,
  SIMILAR_STATUSES,
  type ScoredIssue,
  type SimilarIssue,
} from "@/lib/similar-issues";

/**
 * What happens when an agent creates an issue (#441). The create route (#429)
 * calls `createIssueWithPolicy` and maps its result to a response; it does not
 * repeat any of these rules:
 *
 * - `Idempotency-Key` is required. The same agent and key within 24 hours
 *   returns the issue it already made instead of inserting another.
 * - Open issues with a similar title in the same project are a `409` with the
 *   matches, until the agent repeats the same key with `acknowledgeSimilar`.
 * - Any severity the client sends is ignored: the issue is stored `medium`
 *   until an independent reviewer sets it (#433).
 * - `typeId`, when given, must be an active issue type.
 *
 * It also exports the `(createdAt, id)` cursor #429 pages lists with.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
/** How long a key keeps returning the issue it made. */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_KEY_MAX = 255;

/** Agents never choose severity on create (#441, #433). */
export const AGENT_CREATE_SEVERITY = "medium" as const;

/** Stable JSON serialization so equivalent request objects hash consistently. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

/** Hash the normalized issue-create payload for idempotency comparisons. */
export function hashCreateRequest(body: unknown): string {
  return createHash("sha256").update(stableJson(body)).digest("hex");
}

/** A key is 1–255 visible ASCII characters, like a UUID or a hash. */
export function parseIdempotencyKey(raw: string | null | undefined): string | null {
  const key = raw?.trim();
  if (!key || key.length > IDEMPOTENCY_KEY_MAX) return null;
  return /^[\x21-\x7e]+$/.test(key) ? key : null;
}

/** `acknowledgeSimilar` from a JSON body or a query string. */
export function isAcknowledged(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

// ---------------------------------------------------------------------------
// Similar issues
// ---------------------------------------------------------------------------

/** Searched over, then cut to SIMILAR_LIMIT once scored (as /api/issues/similar). */
const CANDIDATES = 10;

/**
 * Open issues in this project whose title looks like `title`, using the same
 * scoring as the reporter's "is it one of these?" hint (lib/similar-issues.ts).
 */
export async function findSimilarIssues(
  db: Db,
  scope: { tenantId: string; projectId: string },
  title: string,
): Promise<SimilarIssue[]> {
  const query = normalizeQuery(title);
  if (!shouldSearch(query)) return [];
  try {
    const rows = await db.$queryRaw<ScoredIssue[]>`
      SELECT "id", "number", "title", "status", "voteCount",
             GREATEST(similarity("title", ${query}), word_similarity(${query}, "title")) AS "score"
      FROM "Bug"
      WHERE "isDeleted" = false
        AND "tenantId" = ${scope.tenantId}
        AND "projectId" = ${scope.projectId}
        AND "status"::text = ANY(${SIMILAR_STATUSES as string[]})
        AND ("title" % ${query} OR ${query} <% "title")
      ORDER BY "score" DESC
      LIMIT ${CANDIDATES}`;
    return pickSimilar(rows);
  } catch (error) {
    console.error("[agent-create] trigram search failed; using plain matching for this request", error);
  }
  const terms = fallbackTerms(query);
  if (terms.length < 1) return [];
  return db.bug.findMany({
    where: {
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      isDeleted: false,
      status: { in: [...SIMILAR_STATUSES] },
      AND: terms.map((t) => ({ title: { contains: t, mode: "insensitive" as const } })),
    },
    select: { id: true, number: true, title: true, status: true, voteCount: true },
    orderBy: [{ voteCount: "desc" }, { updatedAt: "desc" }],
    take: SIMILAR_LIMIT,
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** The fields the policy decides; the route adds title, description and the rest. */
export type PolicyFields = { severity: typeof AGENT_CREATE_SEVERITY; typeId: string | null };

export type CreatePolicyInput = {
  agent: { agentId: string; tenantId: string };
  projectId: string;
  /** The raw `Idempotency-Key` header. */
  idempotencyKey: string | null | undefined;
  /** SHA-256 hash of the normalized create request. */
  requestHash: string;
  /** Already validated by the route; used for the similar-issue check. */
  title: string;
  typeId?: unknown;
  /** Read and ignored, so a client can't pick severity. */
  severity?: unknown;
  acknowledgeSimilar?: unknown;
  /** Inserts the issue inside the policy's transaction and returns its id. */
  insert: (tx: Prisma.TransactionClient, fields: PolicyFields) => Promise<{ id: string }>;
  now?: Date;
};

export type CreatePolicyResult =
  | { status: 201; bugId: string; replayed: false }
  | { status: 200; bugId: string; replayed: true }
  | { status: 400; error: "missing_idempotency_key" | "invalid_idempotency_key"; message: string }
  | { status: 422; error: "invalid_type"; message: string }
  | { status: 409; error: "similar_issues"; message: string; matches: SimilarIssue[] }
  | { status: 409; error: "idempotency_conflict"; message: string };

/** An active issue type, `null` for none, or `undefined` when it isn't one. */
async function resolveTypeId(
  db: Db,
  typeId: unknown,
  tenantId: string,
): Promise<string | null | undefined> {
  if (typeId === undefined || typeId === null || typeId === "") return null;
  if (typeof typeId !== "string" || typeId.length > 191) return undefined;
  const type = await db.issueType.findUnique({
    where: { id_tenantId: { id: typeId, tenantId } },
    select: { isActive: true },
  });
  return type?.isActive ? typeId : undefined;
}

/** The issue an unexpired key already made, or `null`. */
async function replayFor(db: Db, agentId: string, key: string, cutoff: Date) {
  const existing = await db.idempotencyKey.findUnique({
    where: { agentId_key: { agentId, key } },
    select: { bugId: true, createdAt: true, requestHash: true },
  });
  if (!existing || existing.createdAt <= cutoff) return null;
  return existing;
}

function replayOrConflict(
  existing: { bugId: string | null; requestHash: string | null },
  requestHash: string,
): CreatePolicyResult {
  if (existing.requestHash !== requestHash) {
    return {
      status: 409,
      error: "idempotency_conflict",
      message: "This Idempotency-Key was already used with a different request body.",
    };
  }
  if (existing.bugId) return { status: 200, bugId: existing.bugId, replayed: true };
  return {
    status: 409,
    error: "idempotency_conflict",
    message: "A request with this Idempotency-Key is in progress or failed. Use a new key.",
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createIssueWithPolicy(input: CreatePolicyInput): Promise<CreatePolicyResult> {
  const { agent, projectId } = input;
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS);

  if (!input.idempotencyKey?.trim()) {
    return {
      status: 400,
      error: "missing_idempotency_key",
      message: `Send an ${IDEMPOTENCY_HEADER} header so a retry can't create the issue twice.`,
    };
  }
  const key = parseIdempotencyKey(input.idempotencyKey);
  if (!key) {
    return {
      status: 400,
      error: "invalid_idempotency_key",
      message: `${IDEMPOTENCY_HEADER} must be 1–${IDEMPOTENCY_KEY_MAX} visible ASCII characters, such as a UUID.`,
    };
  }

  // A retry only replays when its normalized request matches the original.
  const earlier = await replayFor(prisma, agent.agentId, key, cutoff);
  if (earlier) return replayOrConflict(earlier, input.requestHash);

  const typeId = await resolveTypeId(prisma, input.typeId, agent.tenantId);
  if (typeId === undefined) {
    return { status: 422, error: "invalid_type", message: "typeId is not an active issue type." };
  }

  if (!isAcknowledged(input.acknowledgeSimilar)) {
    const matches = await findSimilarIssues(prisma, { tenantId: agent.tenantId, projectId }, input.title);
    if (matches.length > 0) {
      // A concurrent retry may have just created the issue, which then looks
      // "similar" to itself: replay it instead.
      const justMade = await replayFor(prisma, agent.agentId, key, cutoff);
      if (justMade) return replayOrConflict(justMade, input.requestHash);
      return {
        status: 409,
        error: "similar_issues",
        message:
          "Open issues with a similar title exist. If yours is different, repeat the request with the same Idempotency-Key and acknowledgeSimilar=true.",
        matches,
      };
    }
  }

  try {
    const bugId = await prisma.$transaction(async (tx) => {
      // A key older than the window is free to reuse.
      await tx.idempotencyKey.deleteMany({
        where: { agentId: agent.agentId, key, createdAt: { lte: cutoff } },
      });
      // Taking the key first means a concurrent retry waits on it, then fails
      // the unique check and replays this issue below.
      const held = await tx.idempotencyKey.create({
        data: { agentId: agent.agentId, key, requestHash: input.requestHash, createdAt: now },
        select: { id: true },
      });
      const bug = await input.insert(tx, { severity: AGENT_CREATE_SEVERITY, typeId });
      await tx.idempotencyKey.update({ where: { id: held.id }, data: { bugId: bug.id } });
      return bug.id;
    });
    return { status: 201, bugId, replayed: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await replayFor(prisma, agent.agentId, key, cutoff);
    if (winner) return replayOrConflict(winner, input.requestHash);
    return {
      status: 409,
      error: "idempotency_conflict",
      message: "A request with this Idempotency-Key is in progress. Retry it shortly.",
    };
  }
}

// ---------------------------------------------------------------------------
// List cursor
// ---------------------------------------------------------------------------

/**
 * A position in a list ordered by `(createdAt, id)`. The id breaks ties, so
 * two issues created in the same millisecond are never skipped or repeated.
 * Offsets aren't used: a new issue would shift every later page.
 */
export type IssueCursor = { createdAt: Date; id: string };

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function encodeCursor(cursor: IssueCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id])).toString("base64url");
}

/** `null` for anything that isn't a cursor this module made. */
export function decodeCursor(raw: string | null | undefined): IssueCursor | null {
  if (!raw || raw.length > 200) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [iso, id] = value;
    if (typeof iso !== "string" || typeof id !== "string" || !id || id.length > 191) return null;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
  } catch {
    return null;
  }
}

/** "desc" for newest first (lists), "asc" for oldest first (feeds). */
export type CursorDirection = "asc" | "desc";

/** Rows after `cursor` in `direction`. Empty when there's no cursor. */
export function cursorWhere(cursor: IssueCursor | null, direction: CursorDirection = "desc"): Prisma.BugWhereInput {
  if (!cursor) return {};
  const beyond = direction === "desc" ? "lt" : "gt";
  return {
    OR: [
      { createdAt: { [beyond]: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { [beyond]: cursor.id } },
    ],
  };
}

export function cursorOrderBy(direction: CursorDirection = "desc"): Prisma.BugOrderByWithRelationInput[] {
  return [{ createdAt: direction }, { id: direction }];
}

/** A `?limit=` value, clamped to 1–MAX_PAGE_SIZE. */
export function pageSize(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

/**
 * Fetch `limit + 1` rows with `cursorWhere` and `cursorOrderBy`, then pass
 * them here: the extra row only says whether there's a next page.
 */
export function toPage<T extends IssueCursor>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
}

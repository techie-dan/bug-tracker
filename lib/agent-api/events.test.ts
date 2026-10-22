import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock prisma before imports
// ---------------------------------------------------------------------------
const db = vi.hoisted(() => ({
  agentEvent: {
    findMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  encodeEventCursor,
  decodeEventCursor,
  parseEventCursor,
  parseEventFilters,
  listEvents,
  publish,
  AGENT_EVENT_TYPES,
  type EventCursor,
} from "./events";

// ---------------------------------------------------------------------------
// Cursor encode / decode
// ---------------------------------------------------------------------------

type LegacyCursor = Extract<EventCursor, { createdAt: Date }>;

describe("event cursor encode/decode", () => {
  const cursor: LegacyCursor = {
    createdAt: new Date("2026-10-19T10:00:00.000Z"),
    id: "evt-abc",
  };

  it("round-trips a cursor without data loss", () => {
    const encoded = encodeEventCursor(cursor);
    const decoded = decodeEventCursor(encoded) as LegacyCursor | null;
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(cursor.id);
    expect(decoded!.createdAt.toISOString()).toBe(cursor.createdAt.toISOString());
  });

  it("returns null for garbage input", () => {
    expect(decodeEventCursor(null)).toBeNull();
    expect(decodeEventCursor("")).toBeNull();
    expect(decodeEventCursor("not-base64")).toBeNull();
    expect(decodeEventCursor("YWJj")).toBeNull(); // valid base64 but bad JSON structure
  });

  it("handles two events at the same timestamp via id ordering", () => {
    const c1: EventCursor = { createdAt: new Date("2026-10-19T10:00:00.000Z"), id: "aaa" };
    const c2: EventCursor = { createdAt: new Date("2026-10-19T10:00:00.000Z"), id: "zzz" };
    const d1 = decodeEventCursor(encodeEventCursor(c1)) as LegacyCursor | null;
    const d2 = decodeEventCursor(encodeEventCursor(c2)) as LegacyCursor | null;
    expect(d1!.id).toBe("aaa");
    expect(d2!.id).toBe("zzz");
    // Both decode to the same timestamp — the id is what breaks the tie.
    expect(d1!.createdAt.toISOString()).toBe(d2!.createdAt.toISOString());
  });

  it("round-trips a transaction cursor (#739)", () => {
    const decoded = decodeEventCursor(encodeEventCursor({ txid: BigInt("9007199254740993"), id: "evt-t" }));
    expect(decoded).toEqual({ txid: BigInt("9007199254740993"), id: "evt-t" });
    // History backfilled before #739 sorts below zero.
    expect(decodeEventCursor(encodeEventCursor({ txid: -BigInt("999999999990"), id: "evt-old" }))).toEqual({
      txid: -BigInt("999999999990"),
      id: "evt-old",
    });
  });

  it("rejects a transaction cursor that is not a whole number", () => {
    const bad = (value: unknown[]) => Buffer.from(JSON.stringify(value)).toString("base64url");
    expect(decodeEventCursor(bad(["t", "1.5", "evt"]))).toBeNull();
    expect(decodeEventCursor(bad(["t", 12, "evt"]))).toBeNull();
    expect(decodeEventCursor(bad(["t", "12", ""]))).toBeNull();
    expect(decodeEventCursor(bad(["t", "1".repeat(20), "evt"]))).toBeNull();
  });

  it("rejects a transaction cursor outside the Postgres bigint range", () => {
    const bad = (value: unknown[]) => Buffer.from(JSON.stringify(value)).toString("base64url");
    expect(decodeEventCursor(bad(["t", "9999999999999999999", "evt"]))).toBeNull();
    expect(decodeEventCursor(bad(["t", "9223372036854775808", "evt"]))).toBeNull();
    expect(decodeEventCursor(bad(["t", "-9223372036854775809", "evt"]))).toBeNull();
    expect(decodeEventCursor(bad(["t", "9223372036854775807", "evt"]))).toEqual({
      txid: BigInt("9223372036854775807"),
      id: "evt",
    });
  });
});

// ---------------------------------------------------------------------------
// parseEventCursor
// ---------------------------------------------------------------------------

describe("parseEventCursor", () => {
  it("returns null when no after param is present", () => {
    expect(parseEventCursor(new URLSearchParams(""))).toBeNull();
  });

  it("decodes a base64url cursor blob", () => {
    const cursor: EventCursor = { createdAt: new Date("2026-10-19T10:00:00.000Z"), id: "evt-1" };
    const encoded = encodeEventCursor(cursor);
    const params = new URLSearchParams({ after: encoded });
    const result = parseEventCursor(params);
    expect(result).not.toBeNull();
    expect(result).not.toBe("invalid");
    if (result && result !== "invalid") {
      expect(result.id).toBe("evt-1");
    }
  });

  it("accepts an ISO timestamp + afterId pair", () => {
    const params = new URLSearchParams({
      after: "2026-10-19T10:00:00.000Z",
      afterId: "evt-2",
    });
    const result = parseEventCursor(params);
    expect(result).not.toBeNull();
    expect(result).not.toBe("invalid");
    if (result && result !== "invalid") {
      expect(result.id).toBe("evt-2");
    }
  });

  it("returns invalid for a bad cursor blob", () => {
    expect(parseEventCursor(new URLSearchParams({ after: "bad!!" }))).toBe("invalid");
  });

  it("returns invalid for a bad timestamp with afterId", () => {
    expect(parseEventCursor(new URLSearchParams({ after: "not-a-date", afterId: "evt-3" }))).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// parseEventFilters (#602)
// ---------------------------------------------------------------------------

describe("parseEventFilters", () => {
  it("returns no filters when none are given", () => {
    expect(parseEventFilters(new URLSearchParams())).toEqual({});
  });

  it("splits exact types and prefixes, trimming and deduping", () => {
    expect(parseEventFilters(new URLSearchParams({ types: "comment.created, claim.*,comment.created,," })))
      .toEqual({ types: ["comment.created"], typePrefixes: ["claim."] });
  });

  it("reads projectId and bugId", () => {
    expect(parseEventFilters(new URLSearchParams({ projectId: "proj-1", bugId: "bug-1" })))
      .toEqual({ projectId: "proj-1", bugId: "bug-1" });
  });

  it("rejects unknown types and lists the valid ones", () => {
    for (const types of ["nope", "comment.created,issue.nope", "*", ".*", "nope.*", "claim", ""]) {
      const result = parseEventFilters(new URLSearchParams({ types }));
      expect(result, types).toMatchObject({ validTypes: AGENT_EVENT_TYPES });
      expect("error" in result && result.error, types).toBeTruthy();
    }
    expect(parseEventFilters(new URLSearchParams({ types: "comment.created,issue.nope" })))
      .toMatchObject({ error: "Unknown event type: issue.nope." });
  });

  it("rejects blank or oversized ids", () => {
    expect(parseEventFilters(new URLSearchParams({ projectId: " " }))).toEqual({ error: "Invalid projectId." });
    expect(parseEventFilters(new URLSearchParams({ bugId: "x".repeat(192) }))).toEqual({ error: "Invalid bugId." });
  });
});

// ---------------------------------------------------------------------------
// listEvents
// ---------------------------------------------------------------------------

describe("listEvents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$queryRaw.mockResolvedValue([{ xmin: "500" }]);
  });

  it("fetches settled events for the agent's tenant with no cursor", async () => {
    db.agentEvent.findMany.mockResolvedValue([]);
    await listEvents({ tenantId: "tenant-a" }, null);
    expect(db.agentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-a", txid: { lt: BigInt("500") } },
        orderBy: [{ txid: "asc" }, { id: "asc" }],
        take: 101,
      }),
    );
  });

  it("applies a (txid, id) cursor (#739)", async () => {
    db.agentEvent.findMany.mockResolvedValue([]);
    await listEvents({ tenantId: "tenant-a" }, { txid: BigInt("120"), id: "evt-x" });
    expect(db.agentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-a",
          txid: { lt: BigInt("500") },
          OR: [{ txid: { gt: BigInt("120") } }, { txid: BigInt("120"), id: { gt: "evt-x" } }],
        },
      }),
    );
  });

  it("still accepts a (createdAt, id) cursor from before #739", async () => {
    db.agentEvent.findMany.mockResolvedValue([]);
    const cursor: EventCursor = { createdAt: new Date("2026-10-19T10:00:00.000Z"), id: "evt-x" };
    await listEvents({ tenantId: "tenant-a" }, cursor);
    expect(db.agentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-a",
          txid: { lt: BigInt("500") },
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        },
      }),
    );
  });

  it("combines type, project and issue filters with the cursor (#602)", async () => {
    db.agentEvent.findMany.mockResolvedValue([]);
    await listEvents({ tenantId: "tenant-a" }, { txid: BigInt("120"), id: "evt-x" }, {
      types: ["comment.created"], typePrefixes: ["claim."], projectId: "proj-1", bugId: "bug-1",
    });
    expect(db.agentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-a",
          projectId: "proj-1",
          bugId: "bug-1",
          AND: [{ OR: [{ type: { in: ["comment.created"] } }, { type: { startsWith: "claim." } }] }],
          txid: { lt: BigInt("500") },
          OR: [{ txid: { gt: BigInt("120") } }, { txid: BigInt("120"), id: { gt: "evt-x" } }],
        },
        orderBy: [{ txid: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("uses a single type match without an OR", async () => {
    db.agentEvent.findMany.mockResolvedValue([]);
    await listEvents({ tenantId: "tenant-a" }, null, { types: ["issue.created", "issue.updated"] });
    expect(db.agentEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-a", AND: [{ type: { in: ["issue.created", "issue.updated"] } }], txid: { lt: BigInt("500") } },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

describe("publish", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("only queues deliveries for subscriptions whose event filter matches (#512)", async () => {
    const fakeDb = {
      agentEvent: { create: vi.fn().mockResolvedValue({ id: "new-event" }) },
      webhookSubscription: { findMany: vi.fn().mockResolvedValue([]) },
      webhookDelivery: { createMany: vi.fn() },
    } as unknown as Parameters<typeof publish>[0];

    await publish(fakeDb, { tenantId: "tenant-a", type: "issue.created", payload: {} });

    const where = (fakeDb.webhookSubscription.findMany as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { events: { isEmpty: true } },
      { events: { has: "issue.created" } },
    ]);
  });

  it("creates an AgentEvent row with the given fields", async () => {
    const fakeDb = {
      agentEvent: { create: vi.fn().mockResolvedValue({ id: "new-event" }) },
      webhookSubscription: { findMany: vi.fn().mockResolvedValue([{ id: "subscription-a" }]) },
      webhookDelivery: { createMany: vi.fn() },
    } as unknown as Parameters<typeof publish>[0];

    const result = await publish(fakeDb, {
      tenantId: "tenant-a",
      type: "issue.created",
      payload: { issueId: "bug-1" },
      actorAgentId: "agent-a",
      bugId: "bug-1",
    });

    expect(result.id).toBe("new-event");
    expect(fakeDb.webhookSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      enabled: true, agent: expect.objectContaining({ tenantId: "tenant-a", revokedAt: null }),
    }) }));
    expect(fakeDb.webhookDelivery.createMany).toHaveBeenCalledWith({
      data: [{ subscriptionId: "subscription-a", eventId: "new-event", nextAttemptAt: expect.any(Date) }], skipDuplicates: true,
    });
    expect((fakeDb as typeof fakeDb & { agentEvent: { create: ReturnType<typeof vi.fn> } }).agentEvent.create)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "tenant-a",
            type: "issue.created",
            payload: { issueId: "bug-1" },
            actorAgentId: "agent-a",
            bugId: "bug-1",
          }),
        }),
      );
  });
});

// ---------------------------------------------------------------------------
// #739: an event that commits after a later one is not skipped
// ---------------------------------------------------------------------------

describe("listEvents with transactions that commit out of order (#739)", () => {
  type Row = { id: string; tenantId: string; txid: bigint; createdAt: Date; committed: boolean };
  let rows: Row[];
  let nextTxid: bigint;

  // A small stand-in for Postgres: uncommitted rows are invisible, and the
  // snapshot's xmin is the oldest transaction still running.
  function matches(row: Row, where: Record<string, unknown>): boolean {
    for (const [key, cond] of Object.entries(where)) {
      if (key === "OR") {
        if (!(cond as Record<string, unknown>[]).some((w) => matches(row, w))) return false;
        continue;
      }
      const value = row[key as keyof Row];
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        const { gt, lt } = cond as { gt?: unknown; lt?: unknown };
        const cmp = (a: unknown, b: unknown) =>
          a instanceof Date && b instanceof Date ? a.getTime() - b.getTime() : a! < b! ? -1 : a! > b! ? 1 : 0;
        if (gt !== undefined && !(cmp(value, gt) > 0)) return false;
        if (lt !== undefined && !(cmp(value, lt) < 0)) return false;
      } else if (cond instanceof Date ? (value as Date).getTime() !== cond.getTime() : value !== cond) {
        return false;
      }
    }
    return true;
  }

  function begin(id: string, createdAt: string): Row {
    const row = { id, tenantId: "tenant-a", txid: nextTxid++, createdAt: new Date(createdAt), committed: false };
    rows.push(row);
    return row;
  }

  async function poll(cursor: EventCursor | null) {
    const page = await listEvents({ tenantId: "tenant-a" }, cursor);
    const last = page.at(-1);
    return { ids: page.map((e) => e.id), cursor: last ? { txid: last.txid, id: last.id } : cursor };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    rows = [];
    nextTxid = BigInt("100");
    db.$queryRaw.mockImplementation(async () => {
      const running = rows.filter((r) => !r.committed).map((r) => r.txid);
      const xmin = running.length ? running.reduce((a, b) => (a < b ? a : b)) : nextTxid;
      return [{ xmin: xmin.toString() }];
    });
    db.agentEvent.findMany.mockImplementation(async ({ where, take }) =>
      rows
        .filter((r) => r.committed && matches(r, where))
        .sort((a, b) => (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : a.id < b.id ? -1 : 1))
        .slice(0, take),
    );
  });

  it("returns an earlier-stamped event that commits after a later one", async () => {
    // Transaction A publishes first but stays open; B publishes later and commits.
    const a = begin("evt-a", "2026-10-20T10:00:00.000Z");
    const b = begin("evt-b", "2026-10-20T10:00:01.000Z");
    b.committed = true;

    // B is held back while A might still commit an event before it.
    const first = await poll(null);
    expect(first.ids).toEqual([]);

    a.committed = true;
    const second = await poll(first.cursor);
    expect(second.ids).toEqual(["evt-a", "evt-b"]);
    expect((await poll(second.cursor)).ids).toEqual([]);
  });

  it("does not skip a transaction that started earlier but publishes late", async () => {
    // A's transaction id is older, but its event is stamped after B's.
    const a = begin("evt-a", "2026-10-20T10:00:05.000Z");
    const b = begin("evt-b", "2026-10-20T10:00:01.000Z");
    b.committed = true;
    const first = await poll(null);

    a.committed = true;
    const second = await poll(first.cursor);
    expect([...first.ids, ...second.ids]).toEqual(["evt-a", "evt-b"]);
  });

  it("keeps delivering once the cursor has moved past a committed event", async () => {
    const a = begin("evt-a", "2026-10-20T10:00:00.000Z");
    a.committed = true;
    const first = await poll(null);
    expect(first.ids).toEqual(["evt-a"]);

    const c = begin("evt-c", "2026-10-20T10:00:02.000Z");
    const b = begin("evt-b", "2026-10-20T10:00:03.000Z");
    b.committed = true;
    const second = await poll(first.cursor);
    expect(second.ids).toEqual([]);

    c.committed = true;
    expect((await poll(second.cursor)).ids).toEqual(["evt-c", "evt-b"]);
  });

  it("releases events once a rolled-back transaction is gone", async () => {
    const rolledBack = begin("evt-x", "2026-10-20T10:00:00.000Z");
    const b = begin("evt-b", "2026-10-20T10:00:01.000Z");
    b.committed = true;
    expect((await poll(null)).ids).toEqual([]);

    rows.splice(rows.indexOf(rolledBack), 1);
    expect((await poll(null)).ids).toEqual(["evt-b"]);
  });
});

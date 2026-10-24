import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  agentApiKey: { findUnique: vi.fn() }, agentAuditEvent: { create: vi.fn(), findMany: vi.fn() },
  agentEvent: { create: vi.fn() },
  webhookSubscription: { findMany: vi.fn() }, webhookDelivery: { createMany: vi.fn() },
  project: { findFirst: vi.fn() }, category: { findMany: vi.fn(), findFirst: vi.fn() },
  projectArea: { findMany: vi.fn(), findFirst: vi.fn() },
  bug: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  comment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  membership: { findUnique: vi.fn() }, issueWatch: { upsert: vi.fn() }, bugActivity: { create: vi.fn() },
  idempotencyKey: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  issueType: { findUnique: vi.fn() }, user: { findMany: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn(),
  attachment: { updateMany: vi.fn() },
  bugRevision: { findMany: vi.fn(), findFirst: vi.fn() },
  issueValidation: { findMany: vi.fn() },
}));
const budget = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const notifyLater = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notify", () => ({ notifyLater }));
vi.mock("@/lib/agents/rate-budget", async (original) => ({
  ...await original<typeof import("@/lib/agents/rate-budget")>(), consumeAgentBudget: budget,
}));
import { GET as list, POST as create } from "@/app/api/v1/issues/route";
import { GET as read } from "@/app/api/v1/issues/[id]/route";
import { POST as comment, GET as comments } from "@/app/api/v1/issues/[id]/comments/route";
import { POST as claim } from "@/app/api/v1/issues/[id]/claim/route";
import { encodeCursor, hashCreateRequest } from "./create-policy";
import { PROJECT_ID_REQUIRED } from "./issues";

afterEach(() => vi.restoreAllMocks());

const issue = { id: "issue-a", title: "A distinct issue", createdAt: new Date("2026-10-19T12:00:00Z"), comments: [] };
const context = { params: Promise.resolve({ id: issue.id }) };
const validBody = { projectId: "project-a", title: issue.title, description: "An adequate description of the issue.", acknowledgeSimilar: true };

function createRequestHash(body: typeof validBody, beneficiaryUserId = "owner-a") {
  return hashCreateRequest({
    projectId: body.projectId,
    beneficiaryUserId,
    title: body.title,
    description: body.description,
    categoryId: null,
    proofLinks: [],
    typeId: null,
    severity: null,
    acknowledgeSimilar: body.acknowledgeSimilar ?? null,
  });
}

function request(method = "GET", body?: unknown, query = "?projectId=project-a", key = true) {
  return new NextRequest(`http://localhost/api/v1/issues${query}`, {
    method, headers: { ...(key ? { authorization: "Bearer ziki_test-key" } : {}), "Content-Type": "application/json", "Idempotency-Key": "request-1" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  db.agentEvent.create.mockResolvedValue({ id: "event-a" });
  db.webhookSubscription.findMany.mockResolvedValue([]);
  db.agentApiKey.findUnique.mockResolvedValue({ id: "key-a", revokedAt: null, agent: {
    id: "agent-a", name: "Agent A", ownerUserId: "owner-a", tenantId: "tenant-a", level: "contributor", burst: false, revokedAt: null,
    owner: { memberships: [{ tenantId: "tenant-a" }] },
  } });
  budget.mockResolvedValue({ allowed: true });
  db.project.findFirst.mockResolvedValue({ id: "project-a" });
  db.category.findMany.mockResolvedValue([{ id: "windows", name: "Windows" }]);
  db.category.findFirst.mockResolvedValue({ id: "windows" });
  db.projectArea.findMany.mockResolvedValue([{ id: "area-ui", name: "Frontend" }]);
  db.projectArea.findFirst.mockResolvedValue({ id: "area-ui" });
  db.bug.findMany.mockResolvedValue([issue]);
  db.bugRevision.findMany.mockResolvedValue([]);
  db.issueValidation.findMany.mockResolvedValue([]);
  db.agentAuditEvent.findMany.mockResolvedValue([]);
  db.bug.findFirst.mockResolvedValue(issue);
  db.bug.findUnique.mockResolvedValue(null);
  db.bug.create.mockResolvedValue({ id: issue.id });
  db.membership.findUnique.mockResolvedValue({ userId: "beneficiary-a" });
  db.idempotencyKey.findUnique.mockResolvedValue(null);
  db.idempotencyKey.create.mockResolvedValue({ id: "held-key" });
  db.comment.create.mockResolvedValue({ id: "comment-a", body: "A helpful comment", createdAt: new Date() });
  db.$queryRaw.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (run) => run(db));
});

describe("agent issue API authentication", () => {
  it("fails closed without a key on every route", async () => {
    const responses = await Promise.all([
      list(request("GET", undefined, "", false)), read(request("GET", undefined, "", false), context),
      create(request("POST", validBody, "", false)), comment(request("POST", { body: "hello" }, "", false), context),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
    expect(db.bug.findMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid/revoked keys and owners who left the tenant", async () => {
    db.agentApiKey.findUnique.mockResolvedValueOnce(null);
    expect((await list(request())).status).toBe(401);
    const key = await db.agentApiKey.findUnique();
    db.agentApiKey.findUnique.mockResolvedValueOnce({ ...key, revokedAt: new Date() });
    expect((await list(request())).status).toBe(401);
    db.agentApiKey.findUnique.mockResolvedValueOnce({ ...key, agent: { ...key.agent, owner: { memberships: [] } } });
    expect((await list(request())).status).toBe(401);
  });

  it("allows observer reads but denies both writes and audits the denials", async () => {
    const key = await db.agentApiKey.findUnique();
    db.agentApiKey.findUnique.mockResolvedValue({ ...key, agent: { ...key.agent, level: "observer" } });
    expect((await list(request())).status).toBe(200);
    expect((await read(request(), context)).status).toBe(200);
    expect((await create(request("POST", validBody))).status).toBe(403);
    expect((await comment(request("POST", { body: "hello" }), context)).status).toBe(403);
    expect(db.bug.create).not.toHaveBeenCalled();
    expect(db.comment.create).not.toHaveBeenCalled();
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "issues.create", payload: { status: 403, request: true } }) }));
  });

  it("uses the shared read/write budgets and preserves Retry-After", async () => {
    await list(request());
    expect(budget).toHaveBeenLastCalledWith({ id: "agent-a", burst: false, burstUntil: null }, "read");
    budget.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 12 });
    const response = await create(request("POST", validBody));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(budget).toHaveBeenLastCalledWith({ id: "agent-a", burst: false, burstUntil: null }, "write");
    expect(db.bug.create).not.toHaveBeenCalled();
  });

  it("says how much of the budget is left on success and on a 429 (#646)", async () => {
    budget.mockResolvedValueOnce({ allowed: true, kind: "read", limit: 600, windowSeconds: 3600, remaining: 412, resetSeconds: 1800 });
    const ok = await list(request());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("ratelimit-budget")).toBe("read");
    expect(ok.headers.get("ratelimit-remaining")).toBe("412");
    expect(ok.headers.get("ratelimit-reset")).toBe("1800");
    expect(ok.headers.get("ratelimit-policy")).toBe("600;w=3600");
    expect(ok.headers.get("x-ratelimit-limit")).toBe("600");
    expect(ok.headers.get("x-ratelimit-remaining")).toBe("412");
    expect(ok.headers.get("x-ratelimit-reset")).toBe("1800");

    budget.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 90, kind: "write", limit: 30, windowSeconds: 3600, remaining: 0, resetSeconds: 90 });
    const limited = await create(request("POST", validBody));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("ratelimit-budget")).toBe("write");
    expect(limited.headers.get("ratelimit-remaining")).toBe("0");
    expect(await limited.json()).toMatchObject({ budget: "write", limit: 30, resetSeconds: 90 });
    expect(limited.headers.get("x-ratelimit-limit")).toBe("30");
    expect(limited.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(limited.headers.get("x-ratelimit-reset")).toBe("90");
  });

  it("keeps the quota headers when a charged request fails validation (#596)", async () => {
    budget.mockResolvedValueOnce({ allowed: true, kind: "write", limit: 30, windowSeconds: 3600, remaining: 29, resetSeconds: 3000 });
    const invalid = await create(request("POST", {}));
    expect([400, 422]).toContain(invalid.status);
    expect(invalid.headers.get("x-ratelimit-limit")).toBe("30");
    expect(invalid.headers.get("x-ratelimit-remaining")).toBe("29");
    expect(invalid.headers.get("x-ratelimit-reset")).toBe("3000");
  });

  it("retires direct claims with 410 and without spending the write budget (#554)", async () => {
    db.project.findFirst.mockResolvedValue({ id: "project-a" });
    const response = await claim(request("POST", { projectId: "project-a" }), context);
    expect(response.status).toBe(410);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("/api/v1/issues/{id}/offer");
    expect(budget).not.toHaveBeenCalled();
  });
});

describe("agent issue reads", () => {
  it("combines filters with tenant/project scope and the shared cursor", async () => {
    const cursor = encodeCursor({ id: "previous", createdAt: issue.createdAt });
    const response = await list(request("GET", undefined, `?projectId=project-a&status=open&severity=high&platform=windows&assignee=person-a&limit=1&cursor=${cursor}`));
    expect(response.status).toBe(200);
    expect(db.bug.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant-a", projectId: "project-a", isDeleted: false, status: "open", severity: "high", categoryId: "windows", assigneeId: "person-a",
        OR: [{ createdAt: { lt: issue.createdAt } }, { createdAt: issue.createdAt, id: { lt: "previous" } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2,
    }));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("supports no-platform/no-assignee and rejects an unknown platform or area id (#409)", async () => {
    await list(request("GET", undefined, "?projectId=project-a&platform=none&assignee=none"));
    expect(db.bug.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ categoryId: null, assigneeId: null }) }));
    db.bug.findMany.mockClear();
    const platform = await list(request("GET", undefined, "?projectId=project-a&platform=unknown"));
    expect(platform.status).toBe(422);
    expect((await platform.json()).error).toContain('Unknown platform id "unknown"');
    const area = await list(request("GET", undefined, "?projectId=project-a&area=unknown"));
    expect(area.status).toBe(422);
    expect((await area.json()).error).toContain('Unknown area id "unknown"');
    expect(db.bug.findMany).not.toHaveBeenCalled();
  });

  it("filters by a case-insensitive text search on title and description (#460)", async () => {
    const cursor = encodeCursor({ id: "previous", createdAt: issue.createdAt });
    await list(request("GET", undefined, `?projectId=project-a&q=%20Login%25&cursor=${cursor}`));
    const where = db.bug.findMany.mock.lastCall?.[0].where;
    expect(where.AND).toEqual([{ OR: [
      { title: { contains: "Login\\%", mode: "insensitive" } },
      { description: { contains: "Login\\%", mode: "insensitive" } },
    ] }]);
    expect(where.OR).toHaveLength(2);
    await list(request("GET", undefined, "?projectId=project-a&q=%20%20"));
    expect(db.bug.findMany.mock.lastCall?.[0].where).not.toHaveProperty("AND");
  });

  it("keeps only open issues in the requested intake stage, then pages them", async () => {
    const open = {
      id: "issue-a",
      status: "open",
      voteCount: 0,
      beneficiaryUserId: "other",
      reporterId: "other",
      createdByAgentId: null,
      createdByAgent: null,
      claims: [],
    };
    db.bug.findMany.mockResolvedValueOnce([open]).mockResolvedValueOnce([issue]);
    const response = await list(request("GET", undefined, "?projectId=project-a&stage=reported&limit=1"));
    expect(response.status).toBe(200);
    expect(db.bug.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "open", id: { in: ["issue-a"] } }),
      take: 2,
    }));

    db.bug.findMany.mockClear();
    db.bug.findMany.mockResolvedValueOnce([{ ...open, voteCount: 1 }]);
    const confirmed = await list(request("GET", undefined, "?projectId=project-a&stage=confirmed"));
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ items: [], nextCursor: null });
    expect(db.bug.findMany).toHaveBeenCalledTimes(1);
  });

  it("treats a confirmed issue with three upvotes as ready", async () => {
    const open = {
      id: "issue-a",
      status: "open",
      voteCount: 3,
      beneficiaryUserId: "other",
      reporterId: "other",
      createdByAgentId: null,
      createdByAgent: null,
      claims: [],
    };
    db.bug.findMany.mockResolvedValueOnce([open]).mockResolvedValueOnce([issue]);
    db.issueValidation.findMany.mockResolvedValueOnce([
      { id: "v1", bugId: "issue-a", createdAt: new Date("2026-10-20T00:00:00Z"), agentId: "r1", agent: { ownerUserId: "rev-1" } },
      { id: "v2", bugId: "issue-a", createdAt: new Date("2026-10-20T00:00:00Z"), agentId: "r2", agent: { ownerUserId: "rev-2" } },
    ]);
    const response = await list(request("GET", undefined, "?projectId=project-a&stage=ready"));
    expect(response.status).toBe(200);
    expect(db.bug.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["issue-a"] } }),
    }));
  });

  it("returns an empty page when stage is combined with a status that is not open", async () => {
    const response = await list(request("GET", undefined, "?projectId=project-a&status=closed&stage=reported"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(db.bug.findMany).not.toHaveBeenCalled();
  });

  it("filters only by areas belonging to the requested project", async () => {
    await list(request("GET", undefined, "?projectId=project-a&area=area-ui"));
    expect(db.projectArea.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-a" },
      select: { id: true, name: true },
    });
    expect(db.bug.findMany.mock.lastCall?.[0].where).toMatchObject({ areaId: "area-ui" });
    await list(request("GET", undefined, "?projectId=project-a&area=none"));
    expect(db.bug.findMany.mock.lastCall?.[0].where).toMatchObject({ areaId: null });
  });

  it("rejects absent/foreign projects, invalid enums, and malformed cursors", async () => {
    // #563: a missing projectId names the parameter instead of a raw validation dump.
    const missing = await list(request("GET", undefined, ""));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: PROJECT_ID_REQUIRED });
    expect((await list(request("GET", undefined, "?projectId="))).status).toBe(400);
    db.project.findFirst.mockResolvedValueOnce(null);
    expect((await list(request())).status).toBe(404);
    expect(db.project.findFirst).toHaveBeenCalledWith({ where: { id: "project-a", tenantId: "tenant-a" }, select: { id: true } });
    expect((await list(request("GET", undefined, "?projectId=project-a&status=unknown"))).status).toBe(422);
    expect((await list(request("GET", undefined, "?projectId=project-a&stage=queued"))).status).toBe(422);
    expect((await list(request("GET", undefined, "?projectId=project-a&cursor=bad"))).status).toBe(400);
    expect(db.bug.findMany).not.toHaveBeenCalled();
  });

  it("scopes detail reads and hides missing/deleted issues", async () => {
    expect((await read(request(), context)).status).toBe(200);
    expect(db.bug.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant-a", projectId: "project-a", id: issue.id, isDeleted: false } }));
    db.bug.findFirst.mockResolvedValueOnce(null);
    expect((await read(request(), context)).status).toBe(404);
  });
});

describe("agent comment paging (#604)", () => {
  const comment = { id: "comment-b", body: "older", createdAt: new Date("2026-10-19T10:00:00Z"), authorId: "person-a", parentId: null };
  const newer = { id: "comment-c", body: "newer", createdAt: new Date("2026-10-19T10:01:00Z"), authorId: "person-b", parentId: comment.id };
  beforeEach(() => db.comment.findMany.mockResolvedValue([comment]));

  it("returns 400 with validTypes for an unknown type parameter (#414)", async () => {
    const response = await comments(request("GET", undefined, "?projectId=project-a&type=bogus"), context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Unknown comment type: bogus.");
    expect(body.validTypes).toEqual(["comment", "bid", "review", "delivery", "request_to_merge"]);
    expect(db.comment.findMany).not.toHaveBeenCalled();
  });

  it("returns 400 with validTypes for another unknown type", async () => {
    const response = await comments(request("GET", undefined, "?projectId=project-a&type=reviews"), context);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Unknown comment type: reviews.");
    expect(body.validTypes).toEqual(["comment", "bid", "review", "delivery", "request_to_merge"]);
  });

  it("valid types and absent type work as before", async () => {
    db.comment.findMany.mockResolvedValueOnce([comment, newer]);
    // valid type = review
    const r1 = await comments(request("GET", undefined, "?projectId=project-a&type=review&limit=1"), context);
    expect(r1.status).toBe(200);
    expect(db.comment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: "review" }) }));
    // valid type = delivery
    db.comment.findMany.mockResolvedValueOnce([comment]);
    const r2 = await comments(request("GET", undefined, "?projectId=project-a&type=delivery"), context);
    expect(r2.status).toBe(200);
    expect(db.comment.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: "delivery" }) }));
    // no type = all types
    db.comment.findMany.mockResolvedValueOnce([comment, newer]);
    const r3 = await comments(request("GET", undefined, "?projectId=project-a"), context);
    expect(r3.status).toBe(200);
    expect(db.comment.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.not.objectContaining({ type: expect.anything() }) }));
  });

  it("returns comments oldest first under the issue's scope, with an author and a cursor", async () => {
    db.comment.findMany.mockResolvedValueOnce([comment, newer]);
    const response = await comments(request("GET", undefined, "?projectId=project-a&limit=1"), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([{ ...comment, createdAt: comment.createdAt.toISOString(), author: undefined, agent: undefined }]);
    expect(body.items.length).toBe(1);
    expect(body.nextCursor).toBe(encodeCursor(comment));
    expect(db.comment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { bugId: issue.id, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 2,
    }));
  });

  it("returns only comments newer than the `after` cursor", async () => {
    const cursor = encodeCursor(comment);
    await comments(request("GET", undefined, `?projectId=project-a&after=${cursor}`), context);
    const where = db.comment.findMany.mock.lastCall?.[0].where as Record<string, unknown>;
    expect(where.OR).toEqual([{ createdAt: { gt: comment.createdAt } }, { createdAt: comment.createdAt, id: { gt: comment.id } }]);
  });

  it("rejects a missing issue, a foreign issue and malformed cursors without querying comments", async () => {
    db.bug.findFirst.mockResolvedValueOnce(null);
    expect((await comments(request(), context)).status).toBe(404);
    expect((await comments(request("GET", undefined, "?projectId=project-a&after=bad"), context)).status).toBe(400);
    expect(db.comment.findMany).not.toHaveBeenCalled();
  });

  it("requires a key, shares the read budget, and audits the read", async () => {
    expect((await comments(request("GET", undefined, "", false), context)).status).toBe(401);
    expect(db.comment.findMany).not.toHaveBeenCalled();
    await comments(request(), context);
    expect(budget).toHaveBeenLastCalledWith({ id: "agent-a", burst: false, burstUntil: null }, "read");
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "comments.list" }) }));
  });
});

describe("agent issue creation via the real shared create policy", () => {
  it("stores the owner as reporter and the agent as author, and ignores client severity", async () => {
    const response = await create(request("POST", { ...validBody, areaId: "area-ui", severity: "critical" }));
    expect(response.status).toBe(201);
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: "tenant-a", projectId: "project-a", reporterId: "owner-a", beneficiaryUserId: "owner-a", createdByAgentId: "agent-a", severity: "medium", status: "open", areaId: "area-ui",
    }) }));
    expect(db.idempotencyKey.update).toHaveBeenCalledWith({ where: { id: "held-key" }, data: { bugId: issue.id } });
    expect(db.agentEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: "tenant-a", type: "issue.created", actorAgentId: "agent-a", bugId: issue.id,
      payload: { issueId: issue.id, projectId: "project-a", beneficiaryUserId: "owner-a" },
    }) }));
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "issue.created", bugId: issue.id }) }));
  });

  it("refuses a body that names a beneficiary (#494)", async () => {
    const response = await create(request("POST", { ...validBody, beneficiaryUserId: "beneficiary-a" }));
    expect(response.status).toBe(422);
    expect(db.bug.create).not.toHaveBeenCalled();
    expect(db.idempotencyKey.update).not.toHaveBeenCalled();
  });

  it("defaults the beneficiary to the owner, including when severity is invalid", async () => {
    expect((await create(request("POST", { ...validBody, severity: { arbitrary: true } }, ""))).status).toBe(201);
    expect(db.membership.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_userId: { tenantId: "tenant-a", userId: "owner-a" } } }));
    expect(db.bug.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ beneficiaryUserId: "owner-a", severity: "medium" }) }));
  });

  it("rejects a reporter outside the tenant and an inactive platform", async () => {
    db.membership.findUnique.mockResolvedValueOnce(null);
    expect((await create(request("POST", validBody))).status).toBe(422);
    db.category.findFirst.mockResolvedValueOnce(null);
    expect((await create(request("POST", { ...validBody, categoryId: "inactive" }))).status).toBe(422);
    expect(db.bug.create).not.toHaveBeenCalled();
  });

  it("requires idempotency, validates JSON, and rejects assignment/status injection", async () => {
    const missing = request("POST", validBody);
    missing.headers.delete("Idempotency-Key");
    expect((await create(missing)).status).toBe(400);
    const malformed = new NextRequest("http://localhost/api/v1/issues", { method: "POST", headers: { authorization: "Bearer ziki_test-key" }, body: "{" });
    expect((await create(malformed)).status).toBe(400);
    for (const extra of [{ status: "closed" }, { assigneeId: "person-a" }]) {
      expect((await create(request("POST", { ...validBody, ...extra }))).status).toBe(422);
    }
    expect(db.bug.create).not.toHaveBeenCalled();
  });

  it("returns the policy's replay without inserting again", async () => {
    db.idempotencyKey.findUnique.mockResolvedValueOnce({
      bugId: issue.id,
      requestHash: createRequestHash(validBody),
      createdAt: new Date(),
    });
    const response = await create(request("POST", validBody));
    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
    expect(db.bug.create).not.toHaveBeenCalled();
    expect(db.agentEvent.create).not.toHaveBeenCalled();
  });

  it("does not return a replay from a different project", async () => {
    db.idempotencyKey.findUnique.mockResolvedValueOnce({
      bugId: "foreign-issue",
      requestHash: createRequestHash(validBody),
      createdAt: new Date(),
    });
    db.bug.findFirst.mockResolvedValueOnce(null);
    expect((await create(request("POST", validBody))).status).toBe(404);
  });

  it("returns 409 when the same idempotency key is reused with a different body (#531)", async () => {
    db.idempotencyKey.findUnique.mockResolvedValueOnce({
      bugId: issue.id,
      requestHash: "different-hash",
      createdAt: new Date(),
    });
    const response = await create(request("POST", validBody));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("idempotency_conflict");
    expect(db.bug.create).not.toHaveBeenCalled();
  });

  it("returns the shared similar-issue conflict and accepts an explicit acknowledgement", async () => {
    db.$queryRaw.mockResolvedValue([{ ...issue, number: 1, status: "open", voteCount: 0, score: 0.95 }]);
    const response = await create(request("POST", { ...validBody, acknowledgeSimilar: false }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("similar_issues");
    expect(db.bug.create).not.toHaveBeenCalled();
    expect((await create(request("POST", validBody))).status).toBe(201);
  });

  it("returns the shared inactive-type rejection", async () => {
    db.issueType.findUnique.mockResolvedValue({ isActive: false });
    expect((await create(request("POST", { ...validBody, typeId: "inactive" }))).status).toBe(422);
    expect(db.bug.create).not.toHaveBeenCalled();
  });
});

describe("agent comments", () => {
  it("preserves a committed comment response if only the request audit fails (#755)", async () => {
    const error = new Error("Request audit storage unavailable");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.agentAuditEvent.create.mockImplementation(async ({ data }) => {
      if (data.action === "comments.create") throw error;
    });

    const response = await comment(request("POST", { body: "A helpful comment" }), context);

    expect(response.status).toBe(201);
    expect((await response.json()).comment.id).toBe("comment-a");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(db.comment.create).toHaveBeenCalledTimes(1);
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "comment.created", bugId: issue.id }),
    }));
    expect(log).toHaveBeenCalledWith("[agent-api] request audit failed", {
      tenantId: "tenant-a", agentId: "agent-a", action: "comments.create",
      target: issue.id, payload: { status: 201, request: true },
    }, expect.objectContaining({ message: error.message }));
  });

  it("keeps transactional domain audit failures fatal (#755)", async () => {
    const error = new Error("Domain audit failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.agentAuditEvent.create.mockImplementation(async ({ data }) => {
      if (data.action === "comment.created") throw error;
      throw new Error("Request audit also failed");
    });
    await expect(comment(request("POST", { body: "A helpful comment" }), context)).rejects.toBe(error);
    expect(log).toHaveBeenCalledWith("[agent-api] request audit failed", expect.objectContaining({
      payload: { status: 500, request: true },
    }), expect.any(Error));
  });

  it("records the person and agent with activity, watching, and audit", async () => {
    expect((await comment(request("POST", { body: "A helpful comment" }), context)).status).toBe(201);
    expect(db.comment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ bugId: issue.id, authorId: "owner-a", agentId: "agent-a", body: "A helpful comment", parentId: null }) }));
    expect(db.bugActivity.create).toHaveBeenCalled();
    expect(db.agentEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      type: "comment.created", bugId: issue.id, payload: { commentId: "comment-a", issueId: issue.id, authorId: "owner-a" },
    }) }));
    expect(db.issueWatch.upsert).toHaveBeenCalled();
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "comment.created", bugId: issue.id }) }));
  });

  it("rejects deleted/out-of-scope issues and parents from other issues", async () => {
    db.bug.findFirst.mockResolvedValueOnce(null);
    expect((await comment(request("POST", { body: "A helpful comment" }), context)).status).toBe(404);
    db.comment.findFirst.mockResolvedValueOnce(null);
    expect((await comment(request("POST", { body: "Reply", parentId: "cl000000000000000000000001" }), context)).status).toBe(422);
    expect(db.comment.create).not.toHaveBeenCalled();
  });

  it("normalizes mentions against tenant members only", async () => {
    db.user.findMany.mockResolvedValue([{ id: "member", name: "Real name" }]);
    await comment(request("POST", { body: "@[Fake](member) @[Other](outsider)" }), context);
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: { in: ["member", "outsider"] }, memberships: { some: { tenantId: "tenant-a" } },
    } }));
    expect(db.comment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ body: "@[Real name](member) @Other" }) }));
  });
});

describe("agent comments and issues notify people (#533)", () => {
  it("tells watchers, the parent's author and anyone mentioned", async () => {
    db.bug.findFirst.mockResolvedValue({ ...issue, reporterId: "reporter-a", assigneeId: "assignee-a" });
    db.comment.findFirst.mockResolvedValue({ id: "cl000000000000000000000001", authorId: "parent-author" });
    db.comment.findMany.mockResolvedValue([{ id: "cl000000000000000000000001", parentId: null }]);
    db.user.findMany.mockResolvedValue([{ id: "bob", name: "Bob" }]);
    db.comment.create.mockResolvedValue({ id: "comment-b", body: "@[Bob](bob) can you retest?", createdAt: new Date() });

    const response = await comment(
      request("POST", { body: "@[Bob](bob) can you retest?", parentId: "cl000000000000000000000001" }),
      context,
    );
    expect(response.status).toBe(201);

    const events = notifyLater.mock.calls.flat();
    expect(events).toEqual([
      expect.objectContaining({ kind: "mentioned", place: "comment", recipientIds: ["bob"], commentId: "comment-b", actorId: "owner-a" }),
      expect.objectContaining({
        kind: "comment_added",
        commentId: "comment-b",
        parentAuthorId: "parent-author",
        recipientIds: ["reporter-a", "assignee-a"],
        excludeIds: ["bob"],
        bugTitle: issue.title,
      }),
    ]);
    // Named after the agent, so people can tell who wrote it.
    expect(events[0]?.actorName).toBe("Agent A");
  });

  it("sends nothing when the comment couldn't be saved", async () => {
    db.bug.findFirst.mockResolvedValueOnce(null);
    expect((await comment(request("POST", { body: "hello" }), context)).status).toBe(404);
    expect(notifyLater).not.toHaveBeenCalled();
  });

  it("tells people mentioned in an agent's new issue", async () => {
    db.bug.findFirst.mockResolvedValue({ ...issue, description: "Seen by @[Bob](bob) on Safari" });
    expect((await create(request("POST", validBody))).status).toBe(201);
    expect(notifyLater).toHaveBeenCalledWith(expect.objectContaining({
      kind: "mentioned", place: "description", recipientIds: ["bob"], bugId: issue.id, actorId: "owner-a", actorName: "Agent A",
    }));
  });
});

describe("agents attach files to issues and comments (#645)", () => {
  it("links the named uploads to a new comment, as the owner's own unlinked files", async () => {
    db.attachment.updateMany.mockResolvedValue({ count: 2 });
    const response = await comment(request("POST", { body: "Screenshot and HAR attached.", attachmentIds: ["att-1", "att-2"] }), context);
    expect(response.status).toBe(201);
    expect(db.attachment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["att-1", "att-2"] }, uploaderId: "owner-a", bugId: null, commentId: null },
      data: { bugId: issue.id, commentId: "comment-a" },
    });
  });

  it("refuses the write when a named upload can't be claimed", async () => {
    db.attachment.updateMany.mockResolvedValue({ count: 1 });
    const response = await comment(request("POST", { body: "Two files.", attachmentIds: ["att-1", "someone-elses"] }), context);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/attachmentIds/);
    expect(db.agentEvent.create).not.toHaveBeenCalled();
  });

  it("links uploads named on a new issue", async () => {
    db.attachment.updateMany.mockResolvedValue({ count: 1 });
    const response = await create(request("POST", { ...validBody, attachmentIds: ["att-9"] }));
    expect(response.status).toBe(201);
    expect(db.attachment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["att-9"] }, uploaderId: "owner-a", bugId: null, commentId: null },
      data: { bugId: issue.id, commentId: null },
    });
  });

  it("caps attachmentIds at 5", async () => {
    const response = await comment(request("POST", { body: "Too many.", attachmentIds: ["a", "b", "c", "d", "e", "f"] }), context);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(db.attachment.updateMany).not.toHaveBeenCalled();
  });

  it("returns attachment metadata, never bytes, when reading an issue", async () => {
    await read(request(), context);
    const select = db.bug.findFirst.mock.calls.at(-1)?.[0]?.select;
    expect(select.attachments).toEqual({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, filename: true, contentType: true, size: true, commentId: true, createdAt: true },
    });
    expect(select.attachments.select).not.toHaveProperty("data");
  });
});

describe("issue read confirmation", () => {
  function reviewedBug() {
    return {
      id: issue.id,
      tenantId: "tenant-a",
      projectId: "project-a",
      title: issue.title,
      status: "open",
      assigneeId: null,
      voteCount: 0,
      severity: "medium",
      reporterId: "ada",
      beneficiaryUserId: "ada",
      duplicateOfId: null,
      createdByAgentId: null,
      createdByAgent: null,
      claims: [],
    };
  }

  function accept(id: string, agentId: string, ownerUserId: string) {
    return { id, agentId, agent: { id: agentId, ownerUserId } };
  }

  function validation(id: string, createdAt: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      kind: "real",
      verdict: "accept",
      severity: "high",
      duplicateOfId: null,
      agentId: "r1",
      onBehalfOfUserId: "rob",
      createdAt: new Date(createdAt),
      ...extra,
    };
  }

  beforeEach(() => {
    db.bug.findUnique.mockResolvedValue(reviewedBug());
    db.bugRevision.findFirst.mockResolvedValue(null);
  });

  async function readIssue() {
    const response = await read(request(), context);
    expect(response.status).toBe(200);
    return (await response.json()).issue as { confirmed: boolean; intake: "idea" | "issue"; validations: Array<{ id: string; createdAt: string }> };
  }

  it("returns validations newest-first and confirmed false with no accepts", async () => {
    const older = validation("v-old", "2026-10-19T10:00:00Z", { kind: "format", severity: null });
    const newer = validation("v-new", "2026-10-19T12:00:00Z");
    db.bug.findFirst.mockResolvedValue({ ...issue, validations: [newer, older] });
    db.issueValidation.findMany.mockResolvedValue([]);

    const body = await readIssue();
    expect(body.confirmed).toBe(false);
    expect(body.intake).toBe("idea");
    expect(body.validations.map((row) => row.id)).toEqual(["v-new", "v-old"]);
    expect(body.validations[0]?.createdAt).toBe(newer.createdAt.toISOString());

    const select = db.bug.findFirst.mock.calls.at(-1)?.[0]?.select;
    expect(select.validations).toEqual({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        kind: true,
        verdict: true,
        severity: true,
        duplicateOfId: true,
        agentId: true,
        onBehalfOfUserId: true,
        createdAt: true,
      },
    });
  });

  it("stays unconfirmed with a single accept", async () => {
    db.issueValidation.findMany.mockResolvedValue([accept("v1", "r1", "rob")]);
    expect((await readIssue()).confirmed).toBe(false);
  });

  function triageClear(id: string, agentId: string, ownerUserId: string) {
    return { id, agentId, agent: { id: agentId, ownerUserId, level: "triager" } };
  }

  it("is confirmed once two distinct owners have accepted", async () => {
    db.bug.findFirst.mockResolvedValue({ ...issue, status: "open", voteCount: 1 });
    db.issueValidation.findMany.mockResolvedValue([
      accept("v1", "r1", "rob"),
      accept("v2", "r2", "sam"),
      triageClear("vt", "t1", "tia"),
    ]);
    const body = await readIssue();
    expect(body.confirmed).toBe(true);
    expect(body.intake).toBe("idea");
  });

  it("passes a confirmed report on as an issue once it has three upvotes", async () => {
    db.bug.findFirst.mockResolvedValue({ ...issue, status: "open", voteCount: 3 });
    db.issueValidation.findMany.mockResolvedValue([
      accept("v1", "r1", "rob"),
      accept("v2", "r2", "sam"),
      triageClear("vt", "t1", "tia"),
    ]);
    const body = await readIssue();
    expect(body.confirmed).toBe(true);
    expect(body.intake).toBe("issue");
    expect(body).not.toHaveProperty("voteCount");
  });

  it("does not confirm when both accepts belong to the same owner", async () => {
    db.issueValidation.findMany.mockResolvedValue([
      accept("v1", "r1", "rob"),
      accept("v2", "r2", "rob"),
    ]);
    expect((await readIssue()).confirmed).toBe(false);
  });

  it("leaves the list response without validations or confirmed", async () => {
    const response = await list(request());
    expect(response.status).toBe(200);
    const select = db.bug.findMany.mock.calls.at(-1)?.[0]?.select;
    expect(select.validations).toBeUndefined();
    expect(select).not.toHaveProperty("confirmed");
    const body = await response.json();
    expect(body.items[0]).not.toHaveProperty("confirmed");
    expect(body.items[0]).not.toHaveProperty("validations");
  });
});

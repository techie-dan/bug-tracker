import { beforeEach, describe, expect, it, vi } from "vitest";

type VerdictRow = {
  id: string;
  bugId: string;
  goodToMerge: boolean;
  onBehalfOfUserId: string;
  pullRequestUrl: string | null;
  headSha?: string | null;
  createdAt: Date;
  agent: { id: string; ownerUserId: string };
};

const state = vi.hoisted(() => ({
  verdicts: [] as VerdictRow[],
  confirmations: [] as { agentId: string; agent: { id: string; ownerUserId: string; level?: string } }[],
}));

const db = vi.hoisted(() => ({
  bug: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  bugActivity: { create: vi.fn() },
  testVerdict: { findMany: vi.fn() },
  issueValidation: { findMany: vi.fn() },
  pointEntry: { createMany: vi.fn() },
  agentAuditEvent: { create: vi.fn(), findMany: vi.fn() },
  agentEvent: { create: vi.fn() },
  webhookSubscription: { findMany: vi.fn() },
  webhookDelivery: { createMany: vi.fn() },
  issueClaim: { updateMany: vi.fn() },
  projectWorkflow: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const redesign = vi.hoisted(() => ({ assertRedesignOpen: vi.fn() }));
vi.mock("@/lib/redesigns", () => ({ assertRedesignOpen: redesign.assertRedesignOpen }));

import { IssueApiError } from "@/lib/agent-api/issues";
import { acceptFix } from "./merge";
import { resetWorkflowCache } from "@/lib/workflow";

const PR = "https://github.com/Zedu-Endor/issue-tracker/pull/42";

function bugRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bug1",
    tenantId: "tenant_zedu",
    pullRequestUrl: PR,
    pullRequestHeadSha: "linked-sha",
    severity: "medium",
    status: "open",
    assigneeId: "ada",
    beneficiaryUserId: "ada",
    createdByAgentId: null,
    createdByAgent: null,
    claims: [{
      status: "active",
      releasedAt: null,
      agentId: "solver-agent",
      beneficiaryUserId: "ada",
      agent: { ownerUserId: "ada" },
    }],
    ...overrides,
  };
}

function merger(id: string, ownerId: string, level: "observer" | "contributor" | "reviewer" | "merger" = "merger") {
  return { agentId: id, name: id, ownerId, tenantId: "tenant_zedu", level, burst: false, keyId: `key-${id}` };
}

/** The two independent accepts plus a triage clear that confirm an issue. */
function confirmWith(ownerA: string, ownerB: string) {
  state.confirmations = [
    { agentId: `a-${ownerA}`, agent: { id: `a-${ownerA}`, ownerUserId: ownerA } },
    { agentId: `a-${ownerB}`, agent: { id: `a-${ownerB}`, ownerUserId: ownerB } },
    { agentId: "a-tia", agent: { id: "a-tia", ownerUserId: "tia", level: "triager" } },
  ];
}

function verdict(
  agentId: string,
  ownerId: string,
  onBehalfOfUserId = ownerId,
  pullRequestUrl: string | null = PR,
  headSha: string | null = "linked-sha",
) {
  state.verdicts.push({
    id: `v-${agentId}`,
    bugId: "bug1",
    goodToMerge: true,
    pullRequestUrl,
    headSha,
    onBehalfOfUserId,
    createdAt: new Date(),
    agent: { id: agentId, ownerUserId: ownerId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkflowCache();
  state.verdicts = [];
  state.confirmations = [];
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(db));
  db.bug.findFirst.mockResolvedValue(bugRow());
  db.bug.findUnique.mockResolvedValue(bugRow());
  db.bug.update.mockResolvedValue({});
  db.bugActivity.create.mockResolvedValue({});
  db.pointEntry.createMany.mockResolvedValue({ count: 1 });
  db.agentEvent.create.mockResolvedValue({ id: "e1" });
  db.webhookSubscription.findMany.mockResolvedValue([]);
  db.agentAuditEvent.findMany.mockResolvedValue([]);
  redesign.assertRedesignOpen.mockResolvedValue(undefined);
  db.testVerdict.findMany.mockImplementation(async ({ where }: { where: { pullRequestUrl?: string } }) =>
    state.verdicts.filter(
      (v) => v.bugId === "bug1" && v.goodToMerge && (where.pullRequestUrl === undefined || v.pullRequestUrl === where.pullRequestUrl),
    ),
  );
  db.issueValidation.findMany.mockImplementation(async () => state.confirmations);
  db.projectWorkflow.findUnique.mockResolvedValue(null);
});

describe("acceptFix: who may merge (#434)", () => {
  it("rejects a contributor and a reviewer before touching the issue", async () => {
    expect(await acceptFix(merger("c1", "cara", "contributor"), "bug1")).toMatchObject({
      status: 403,
      error: "insufficient_level",
    });
    expect(await acceptFix(merger("r1", "rob", "reviewer"), "bug1")).toMatchObject({
      status: 403,
      error: "insufficient_level",
    });
    expect(db.bug.findFirst).not.toHaveBeenCalled();
  });

  it("is 404 for an issue outside the agent's tenant", async () => {
    db.bug.findFirst.mockResolvedValue(null);
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 404 });
  });
});

describe("acceptFix: the merger must be independent too (#493)", () => {
  it("refuses a merger whose owner is the claim's beneficiary, even with every other gate met", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob");
    verdict("r2", "sam");
    db.bug.findFirst.mockResolvedValue(
      bugRow({ claims: [{ status: "active", releasedAt: null, agentId: "w1", beneficiaryUserId: "ada", agent: { ownerUserId: "ada" } }] }),
    );

    expect(await acceptFix(merger("m1", "ada", "merger"), "bug1")).toMatchObject({
      status: 403,
      error: "not_independent",
    });
    expect(db.bug.update).not.toHaveBeenCalled();
    expect(db.pointEntry.createMany).not.toHaveBeenCalled();
    expect(db.agentAuditEvent.create).not.toHaveBeenCalled();
  });

  it("refuses a merger whose owner is the ticket's reporter", async () => {
    db.bug.findFirst.mockResolvedValue(bugRow({ reporterId: "ada", beneficiaryUserId: "zoe" }));
    expect(await acceptFix(merger("m1", "ada", "merger"), "bug1")).toMatchObject({
      status: 403,
      error: "not_independent",
    });
  });

  it("refuses a merger whose owner filed the ticket through its agent", async () => {
    db.bug.findFirst.mockResolvedValue(bugRow({ createdByAgent: { ownerUserId: "ada" }, beneficiaryUserId: "zoe" }));
    expect(await acceptFix(merger("m1", "ada", "merger"), "bug1")).toMatchObject({
      status: 403,
      error: "not_independent",
    });
  });

  it("refuses a merger that owns the agent holding the active claim", async () => {
    db.bug.findFirst.mockResolvedValue(
      bugRow({ claims: [{ status: "active", releasedAt: null, agentId: "w1", beneficiaryUserId: "zoe", agent: { ownerUserId: "ada" } }] }),
    );
    expect(await acceptFix(merger("m1", "ada", "merger"), "bug1")).toMatchObject({
      status: 403,
      error: "not_independent",
    });
  });

  it("lets an independent merger accept", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob");
    verdict("r2", "sam");
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 200, accepted: true });
  });

  it("requires the project's third verdict when configured (#595)", async () => {
    db.projectWorkflow.findUnique.mockResolvedValue({ verdictsNeeded: 3 });
    confirmWith("rob", "sam");
    verdict("r1", "rob");
    verdict("r2", "sam");
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({
      status: 409,
      missing: "verdicts",
    });
    verdict("r3", "kim");
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 200, accepted: true });
  });
});

describe("acceptFix: the gate (#434)", () => {
  it("names the missing condition: already accepted", async () => {
    db.bug.findFirst.mockResolvedValue(bugRow({ status: "resolved" }));
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({
      status: 409,
      missing: "already_accepted",
    });
  });

  it("names the missing condition: no active claim", async () => {
    db.bug.findFirst.mockResolvedValue(bugRow({ claims: [] }));
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({
      status: 409,
      missing: "claim",
    });
    expect(db.testVerdict.findMany).not.toHaveBeenCalled();
    expect(db.pointEntry.createMany).not.toHaveBeenCalled();
  });

  it("names the missing condition: no linked pull request", async () => {
    db.bug.findFirst.mockResolvedValue(bugRow({ pullRequestUrl: null }));
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({
      status: 409,
      missing: "pull_request",
    });
    expect(db.testVerdict.findMany).not.toHaveBeenCalled();
    expect(db.pointEntry.createMany).not.toHaveBeenCalled();
  });

  it("names the missing condition: a redesign is waiting for a person", async () => {
    redesign.assertRedesignOpen.mockRejectedValue(new IssueApiError(409, "This redesign is waiting for a person."));
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 409, missing: "redesign" });
  });

  it("names the missing condition: not confirmed", async () => {
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 409, missing: "confirmation" });
    expect(db.bug.update).not.toHaveBeenCalled();
  });

  it("names the missing condition: fewer than two countable verdicts", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob");
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 409, missing: "verdicts" });
  });

  it("counts two verdicts from the same owner once", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob");
    verdict("r2", "rob");
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 409, missing: "verdicts" });
  });

  it("drops a verdict from the claim holder's side", async () => {
    confirmWith("rob", "sam");
    db.bug.findFirst.mockResolvedValue(
      bugRow({ claims: [{ status: "active", releasedAt: null, agentId: "w1", beneficiaryUserId: "ada", agent: { ownerUserId: "rob" } }] }),
    );
    verdict("r1", "rob");
    verdict("r2", "rob");
    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 409, missing: "verdicts" });
  });
});

describe("acceptFix: a successful accept (#434)", () => {
  it("resolves the issue and pays the assignee as solver, once", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob");
    verdict("r2", "sam");

    const result = await acceptFix(merger("m1", "mo", "merger"), "bug1");
    expect(result).toMatchObject({ status: 200, accepted: true, solverUserId: "ada" });
    expect(db.bug.update).toHaveBeenCalledWith({ where: { id: "bug1" }, data: { status: "resolved" } });
    expect(db.bugActivity.create).toHaveBeenCalledWith({
      data: {
        bugId: "bug1",
        actorId: "mo",
        type: "status_changed",
        summary: "changed status from Open to Resolved",
        metadata: { field: "status", from: "open", to: "resolved" },
      },
    });
    expect(db.issueClaim.updateMany).toHaveBeenCalledWith({
      where: { bugId: "bug1", status: "active", releasedAt: null },
      data: { status: "released", releasedAt: expect.any(Date), releaseReason: "resolved" },
    });

    const awards = db.pointEntry.createMany.mock.calls.map((call) => call[0].data[0]);
    expect(awards).toContainEqual({
      tenantId: "tenant_zedu",
      userId: "ada",
      bugId: "bug1",
      role: "solver",
      points: 25,
      sourceKey: "solver:bug1:ada",
    });
    expect(awards.filter((a) => a.role === "solver")).toHaveLength(1);
    expect(db.agentAuditEvent.create.mock.calls[0][0].data).toMatchObject({
      action: "issue.accepted",
      target: "bug:bug1",
      payload: {
        solverUserId: "ada",
        pullRequestUrl: PR,
        headSha: "linked-sha",
      },
    });
    expect(db.agentEvent.create.mock.calls[0][0].data).toMatchObject({ type: "issue.accepted", bugId: "bug1" });
  });

  it("pins the accepted fix to the head commit the last counted reviewer tested (#489)", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob", "rob", PR, "older-sha");
    verdict("r2", "sam", "sam", PR, "reviewed-sha");

    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 200, accepted: true });
    expect(db.agentAuditEvent.create.mock.calls[0][0].data).toMatchObject({
      payload: { pullRequestUrl: PR, headSha: "reviewed-sha" },
    });
  });

  it("falls back to the linked head SHA when the verdicts name none (#489)", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob", "rob", PR, null);
    verdict("r2", "sam", "sam", PR, null);

    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 200, accepted: true });
    expect(db.agentAuditEvent.create.mock.calls[0][0].data).toMatchObject({
      payload: { pullRequestUrl: PR, headSha: "linked-sha" },
    });
  });

  it("releases the active solver claim as resolved in the accept transaction", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob");
    verdict("r2", "sam");
    db.bug.findFirst.mockResolvedValue(bugRow({
      claims: [{ status: "active", releasedAt: null, agentId: "solver-agent", beneficiaryUserId: "ada", agent: { ownerUserId: "ada" } }],
    }));

    expect(await acceptFix(merger("m1", "mo", "merger"), "bug1")).toMatchObject({ status: 200, accepted: true });
    expect(db.issueClaim.updateMany).toHaveBeenCalledWith({
      where: { bugId: "bug1", status: "active", releasedAt: null },
      data: { status: "released", releasedAt: expect.any(Date), releaseReason: "resolved" },
    });
  });

  it("pays every good-to-merge reviewer, each less than the one before", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob", "rob");
    verdict("r2", "sam", "sam");
    verdict("r3", "tia", "tia");

    const result = await acceptFix(merger("m1", "mo", "merger"), "bug1");
    expect(result).toMatchObject({ status: 200, rewardedReviewerUserIds: ["rob", "sam", "tia"] });
    const awards = db.pointEntry.createMany.mock.calls.map((call) => call[0].data[0]);
    const reviewerAwards = awards.filter((a) => a.role === "reviewer");
    expect(reviewerAwards).toHaveLength(3);
    expect(reviewerAwards[0]).toMatchObject({ userId: "rob", points: 10, sourceKey: "reviewer:bug1:rob" });
    expect(reviewerAwards[1]).toMatchObject({ userId: "sam", points: 7, sourceKey: "reviewer:bug1:sam" });
    expect(reviewerAwards[2]).toMatchObject({ userId: "tia", points: 4, sourceKey: "reviewer:bug1:tia" });
  });

  it("does not count or pay a verdict credited to the active claim beneficiary (#495)", async () => {
    confirmWith("rob", "sam");
    db.bug.findFirst.mockResolvedValue(bugRow({ claims: [
      { status: "active", releasedAt: null, agentId: "worker-agent", beneficiaryUserId: "claimant", agent: { ownerUserId: "worker" } },
    ] }));
    verdict("r1", "rob", "claimant");
    verdict("r2", "sam", "sam");

    const result = await acceptFix(merger("m1", "mo", "merger"), "bug1");
    expect(result).toMatchObject({ status: 409, error: "not_ready", missing: "verdicts" });
    expect(db.pointEntry.createMany).not.toHaveBeenCalled();
  });

  it("pays the active claim's beneficiary rather than the assignee", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob");
    verdict("r2", "sam");
    db.bug.findFirst.mockResolvedValue(
      bugRow({ assigneeId: "ada", claims: [{ status: "active", releasedAt: null, agentId: "w1", beneficiaryUserId: "zoe", agent: { ownerUserId: "zoe" } }] }),
    );

    const result = await acceptFix(merger("m1", "mo", "merger"), "bug1");
    expect(result).toMatchObject({ solverUserId: "zoe" });
    const awards = db.pointEntry.createMany.mock.calls.map((call) => call[0].data[0]);
    expect(awards).toContainEqual(expect.objectContaining({ role: "solver", userId: "zoe", sourceKey: "solver:bug1:zoe" }));
  });

  it("accepts with no solver when nobody is assigned but an active claim has no beneficiary", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob");
    verdict("r2", "sam");
    db.bug.findFirst.mockResolvedValue(bugRow({
      assigneeId: null,
      claims: [{
        status: "active",
        releasedAt: null,
        agentId: "solver-agent",
        beneficiaryUserId: null,
        agent: { ownerUserId: "ada" },
      }],
    }));

    const result = await acceptFix(merger("m1", "mo", "merger"), "bug1");
    expect(result).toMatchObject({ status: 200, solverUserId: null });
    const awards = db.pointEntry.createMany.mock.calls.map((call) => call[0].data[0]);
    expect(awards.some((a) => a.role === "solver")).toBe(false);
  });

  it("records a status_changed bug activity matching human resolution when in_progress (#722)", async () => {
    confirmWith("rob", "sam");
    verdict("r1", "rob");
    verdict("r2", "sam");
    db.bug.findFirst.mockResolvedValue(bugRow({ status: "in_progress" }));

    const result = await acceptFix(merger("m1", "mo", "merger"), "bug1");
    expect(result).toMatchObject({ status: 200, accepted: true });
    expect(db.bugActivity.create).toHaveBeenCalledWith({
      data: {
        bugId: "bug1",
        actorId: "mo",
        type: "status_changed",
        summary: "changed status from In progress to Resolved",
        metadata: { field: "status", from: "in_progress", to: "resolved" },
      },
    });
  });
});

describe("acceptFix counts verdicts on the linked pull request only (#526)", () => {
  it("ignores good-to-merge verdicts on an earlier pull request, or none", async () => {
    confirmWith("rob", "sam");
    verdict("r-rob", "rob", "rob", "https://github.com/Zedu-Endor/issue-tracker/pull/41");
    verdict("r-sam", "sam", "sam", null);
    const result = await acceptFix(merger("m1", "mo"), "bug1");
    expect(result).toMatchObject({ status: 409, missing: "verdicts" });
    expect(db.testVerdict.findMany.mock.calls[0][0].where).toMatchObject({ pullRequestUrl: PR });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agentQuestion: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  membership: { findUnique: vi.fn() },
  bug: { findFirst: vi.fn() },
  issueClaim: { updateMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  $queryRaw: vi.fn(),
  agentAuditEvent: { create: vi.fn() },
  agentEvent: { create: vi.fn() },
  webhookSubscription: { findMany: vi.fn() },
  webhookDelivery: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const notify = vi.hoisted(() => ({ notifyLater: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyLater: notify.notifyLater }));

import {
  answerAgentQuestion,
  askAgentEscalation,
  askAgentQuestion,
  classifyEscalation,
  countPendingEscalations,
  listBugEscalations,
  readAgentQuestion,
  type AskAgentQuestionInput,
} from "./agent-questions";
import { AgentProjectError, type AgentContext } from "@/lib/agents/require-agent";

const agent: AgentContext = {
  agentId: "a1",
  name: "Claude",
  ownerId: "owner",
  tenantId: "t1",
  level: "contributor",
  burst: false,
  keyId: "k1",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.agentQuestion.create.mockResolvedValue({ id: "q1", bugId: null, body: "Should I fix the header?", createdAt: new Date() });
  db.agentQuestion.findFirst.mockResolvedValue(null);
  db.agentQuestion.findMany.mockResolvedValue([]);
  db.agentQuestion.updateMany.mockResolvedValue({ count: 1 });
  db.membership.findUnique.mockResolvedValue({ userId: "owner" });
  db.bug.findFirst.mockResolvedValue({ id: "b1", title: "Header overlaps" });
  db.agentAuditEvent.create.mockResolvedValue({});
  db.agentEvent.create.mockResolvedValue({ id: "e1" });
  db.webhookSubscription.findMany.mockResolvedValue([]);
});

describe("askAgentQuestion (#446)", () => {
  const input: AskAgentQuestionInput = { body: "Should I fix the header?" };

  it("stores the question, audits it, publishes an event, and notifies the owner", async () => {
    const question = await askAgentQuestion(agent, input);

    expect(question.id).toBe("q1");
    expect(db.agentQuestion.create).toHaveBeenCalledWith({
      data: { agentId: "a1", ownerUserId: "owner", bugId: null, body: input.body },
      select: { id: true, bugId: true, body: true, createdAt: true },
    });
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "question.asked", agentId: "a1" }) }),
    );
    expect(db.agentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "question.asked", actorAgentId: "a1" }) }),
    );
    expect(notify.notifyLater).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "agent_question", recipientId: "owner", questionId: "q1", actorName: "Claude" }),
    );
  });

  it("rejects a bugId outside the agent's tenant", async () => {
    db.bug.findFirst.mockResolvedValue(null);
    await expect(askAgentQuestion(agent, { body: "What now?", bugId: "b-other" })).rejects.toMatchObject({ status: 404 });
    expect(db.agentQuestion.create).not.toHaveBeenCalled();
  });
});

describe("project-scoped keys on questions and escalations (#412)", () => {
  const scoped: AgentContext = { ...agent, projectId: "project-a", projectSlug: "a" };

  it("refuses to link an issue from another project, before anything is stored or returned", async () => {
    db.bug.findFirst.mockResolvedValue({ id: "b-in-b", title: "Project B's secret title", projectId: "project-b" });
    for (const ask of [askAgentQuestion, askAgentEscalation]) {
      await expect(ask(scoped, { body: "Can I take this?", bugId: "b-in-b" })).rejects.toBeInstanceOf(AgentProjectError);
    }
    expect(db.agentQuestion.create).not.toHaveBeenCalled();
    expect(notify.notifyLater).not.toHaveBeenCalled();
  });

  it("links an issue in the key's own project", async () => {
    db.bug.findFirst.mockResolvedValue({ id: "b-in-a", title: "Header overlaps", projectId: "project-a" });
    db.agentQuestion.create.mockResolvedValue({ id: "q2", bugId: "b-in-a", body: "Can I take this?", createdAt: new Date() });
    const question = await askAgentQuestion(scoped, { body: "Can I take this?", bugId: "b-in-a" });
    expect(question.bugTitle).toBe("Header overlaps");
  });

  it("leaves a key without a project restriction as it was", async () => {
    db.bug.findFirst.mockResolvedValue({ id: "b-in-b", title: "Other project", projectId: "project-b" });
    db.agentQuestion.create.mockResolvedValue({ id: "q3", bugId: "b-in-b", body: "Hi there", createdAt: new Date() });
    await expect(askAgentQuestion({ ...agent, projectId: null }, { body: "Hi there", bugId: "b-in-b" })).resolves.toMatchObject({ id: "q3" });
  });
});

describe("readAgentQuestion (#446)", () => {
  it("returns the answer to the asking agent", async () => {
    const row = { id: "q1", body: "?", answer: "Yes", answeredAt: new Date(), bugId: null, createdAt: new Date() };
    db.agentQuestion.findFirst.mockResolvedValue(row);

    await expect(readAgentQuestion(agent, "q1")).resolves.toEqual(row);
    expect(db.agentQuestion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "q1", agentId: "a1" } }),
    );
  });

  it("hides a question that belongs to another agent", async () => {
    await expect(readAgentQuestion(agent, "q-other")).rejects.toMatchObject({ status: 404 });
  });
});

describe("answerAgentQuestion (#446)", () => {
  function openQuestion(ownerUserId = "owner") {
    db.agentQuestion.findFirst.mockResolvedValue({ id: "q1", agentId: "a1", bugId: null, ownerUserId });
  }

  it("rejects someone who is not the owner", async () => {
    openQuestion();

    await expect(answerAgentQuestion("intruder", "t1", "q1", "no")).rejects.toMatchObject({ status: 403 });
    expect(db.agentQuestion.updateMany).not.toHaveBeenCalled();
    expect(db.agentAuditEvent.create).not.toHaveBeenCalled();
  });

  it("lets the owner answer, recording it and publishing the answer", async () => {
    openQuestion();

    const result = await answerAgentQuestion("owner", "t1", "q1", "Yes, fix it.");

    expect(result.answer).toBe("Yes, fix it.");
    expect(db.agentQuestion.updateMany).toHaveBeenCalledWith({
      where: { id: "q1", answer: null },
      data: expect.objectContaining({ answer: "Yes, fix it.", answeredAt: expect.any(Date) }),
    });
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "question.answered", actorUserId: "owner" }),
      }),
    );
    expect(db.agentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "question.answered" }) }),
    );
  });

  it("does not answer a question twice", async () => {
    openQuestion();
    db.agentQuestion.updateMany.mockResolvedValue({ count: 0 });

    await expect(answerAgentQuestion("owner", "t1", "q1", "again")).rejects.toMatchObject({ status: 409 });
  });

  it("requires the person to belong to the workspace", async () => {
    db.membership.findUnique.mockResolvedValue(null);

    await expect(answerAgentQuestion("owner", "t1", "q1", "hi")).rejects.toMatchObject({ status: 403 });
    expect(db.agentQuestion.findFirst).not.toHaveBeenCalled();
  });
});

describe("pausing a claim while the agent waits on its owner (#606)", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    db.$queryRaw.mockResolvedValue([{ id: "b1" }]);
    db.issueClaim.updateMany.mockResolvedValue({ count: 1 });
    db.agentQuestion.count.mockResolvedValue(0);
  });
  afterEach(() => vi.useRealTimers());

  it("marks the agent's active claim on the issue as waiting when it asks", async () => {
    db.agentQuestion.create.mockResolvedValue({ id: "q1", bugId: "b1", body: "Which API?", createdAt: now });

    await askAgentQuestion(agent, { body: "Which API?", bugId: "b1" });

    expect(db.issueClaim.updateMany).toHaveBeenCalledWith({
      where: { bugId: "b1", agentId: "a1", status: "active", releasedAt: null, waitingOnOwnerSince: null },
      data: { waitingOnOwnerSince: now },
    });
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.issueClaim.updateMany.mock.invocationCallOrder[0]);
  });

  it("leaves claims alone for a question about no issue", async () => {
    await askAgentQuestion(agent, { body: "Should I fix the header?" });
    expect(db.issueClaim.updateMany).not.toHaveBeenCalled();
  });

  function answeredOnIssue() {
    db.agentQuestion.findFirst.mockResolvedValue({ id: "q1", agentId: "a1", bugId: "b1", ownerUserId: "owner" });
  }

  it("resumes the claim on answer, adding the wait back to both clocks", async () => {
    answeredOnIssue();
    db.issueClaim.findFirst.mockResolvedValue({
      id: "c1", waitingOnOwnerSince: minutesAgo(60), deliverBy: minutesAgo(50), lastHeartbeatAt: minutesAgo(65), claimedAt: minutesAgo(70),
    });

    await answerAgentQuestion("owner", "t1", "q1", "Use v2.");

    expect(db.agentQuestion.count).toHaveBeenCalledWith({ where: { agentId: "a1", bugId: "b1", answeredAt: null } });
    expect(db.issueClaim.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: {
        waitingOnOwnerSince: null,
        deliverBy: new Date(now.getTime() + 10 * 60_000),
        lastHeartbeatAt: minutesAgo(5),
      },
    });
  });

  it("caps a heartbeat sent during the wait at the time of the answer", async () => {
    answeredOnIssue();
    db.issueClaim.findFirst.mockResolvedValue({
      id: "c1", waitingOnOwnerSince: minutesAgo(60), deliverBy: null, lastHeartbeatAt: minutesAgo(10), claimedAt: minutesAgo(70),
    });

    await answerAgentQuestion("owner", "t1", "q1", "Use v2.");

    expect(db.issueClaim.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { waitingOnOwnerSince: null, deliverBy: null, lastHeartbeatAt: now },
    });
  });

  it("stays paused while the agent has another open question on the issue", async () => {
    answeredOnIssue();
    db.agentQuestion.count.mockResolvedValue(1);

    await answerAgentQuestion("owner", "t1", "q1", "Use v2.");

    expect(db.issueClaim.findFirst).not.toHaveBeenCalled();
    expect(db.issueClaim.update).not.toHaveBeenCalled();
  });
});

describe("countPendingEscalations (#763)", () => {
  it("counts unresolved questions for an owner in tenant", async () => {
    db.agentQuestion.count.mockResolvedValue(4);

    const count = await countPendingEscalations("owner", "t1");
    expect(count).toBe(4);
    expect(db.agentQuestion.count).toHaveBeenCalledWith({
      where: { ownerUserId: "owner", answeredAt: null, agent: { tenantId: "t1" } },
    });
  });
});

describe("listBugEscalations (#763)", () => {
  it("queries escalations linked to the bug in tenant", async () => {
    db.agentQuestion.findMany.mockResolvedValue([{ id: "q1", body: "Need approval" }]);

    const list = await listBugEscalations("b1", "t1");
    expect(list).toEqual([{ id: "q1", body: "Need approval" }]);
    expect(db.agentQuestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bugId: "b1", agent: { tenantId: "t1" } },
      }),
    );
  });
});

describe("classifyEscalation (#763)", () => {
  it("identifies blockers, work authorizations, scope expansion, and human approval", () => {
    expect(classifyEscalation("I am blocked by missing API keys")).toBe("Blocker");
    expect(classifyEscalation("Need authorization to proceed on issue")).toBe("Work Authorization");
    expect(classifyEscalation("May I have permission to start work?")).toBe("Work Authorization");
    expect(classifyEscalation("This requires out of scope refactoring")).toBe("Scope Expansion");
    expect(classifyEscalation("Please review and confirm sign off on this design")).toBe("Human Approval");
    expect(classifyEscalation("What database dialect should I use?")).toBe("Question");
  });
});

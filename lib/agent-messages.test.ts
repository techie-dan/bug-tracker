import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agent: { findUnique: vi.fn(), update: vi.fn() },
  agentMessage: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  agentInboxItem: { create: vi.fn(), findMany: vi.fn() },
  agentQuestion: { findMany: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
  membership: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  AGENT_INSTRUCTIONS_MAX,
  listAgentThread,
  markMessagesRead,
  readAgentInstructions,
  sendAgentMessage,
  setAgentInstructions,
} from "./agent-messages";

const owner = { id: "owner", name: "Ada", role: "user" as const };
const admin = { id: "admin", name: "Grace", role: "user" as const };
const stranger = { id: "stranger", name: "Eve", role: "user" as const };

const agentRow = {
  id: "a1", name: "Ada's Claude", tenantId: "t1", ownerUserId: "owner", revokedAt: null, instructions: "Use staging.",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.agent.findUnique.mockResolvedValue(agentRow);
  db.membership.findUnique.mockImplementation(({ where }) =>
    Promise.resolve(where.tenantId_userId.userId === "admin" ? { role: "admin" } : { role: "member" }),
  );
  db.agentMessage.create.mockResolvedValue({ id: "m1", createdAt: new Date("2026-10-20T10:00:00Z") });
  db.agentMessage.findMany.mockResolvedValue([]);
  db.agentQuestion.findMany.mockResolvedValue([]);
  db.agentInboxItem.findMany.mockResolvedValue([]);
});

describe("sendAgentMessage (#605)", () => {
  it("stores the message, puts it in the agent's inbox as a message, and audits it", async () => {
    const result = await sendAgentMessage(owner, "a1", { body: "  Focus on desktop bugs today.  " });

    expect(result).toEqual({ ok: true, id: "m1" });
    expect(db.agentMessage.create).toHaveBeenCalledWith({
      data: { agentId: "a1", fromUserId: "owner", body: "Focus on desktop bugs today." },
      select: { id: true, createdAt: true },
    });
    expect(db.agentInboxItem.create).toHaveBeenCalledWith({
      data: {
        agentId: "a1",
        kind: "message",
        eventType: "message.sent",
        payload: {
          messageId: "m1",
          agentId: "a1",
          from: { type: "user", id: "owner", name: "Ada", role: "owner" },
          body: "Focus on desktop bugs today.",
        },
        createdAt: new Date("2026-10-20T10:00:00Z"),
      },
    });
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "message.sent", agentId: "a1", actorUserId: "owner", target: "m1" }),
    });
  });

  it("lets an admin of the agent's tenant send one", async () => {
    await expect(sendAgentMessage(admin, "a1", { body: "Stop working on #212." })).resolves.toMatchObject({ ok: true });
    expect(db.agentInboxItem.create.mock.calls[0][0].data.payload.from).toMatchObject({ id: "admin", role: "tenant_admin" });
  });

  it("refuses a member who neither owns the agent nor administers its tenant", async () => {
    await expect(sendAgentMessage(stranger, "a1", { body: "Hi" })).resolves.toMatchObject({ ok: false });
    expect(db.agentMessage.create).not.toHaveBeenCalled();
    expect(db.agentInboxItem.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown or revoked agent and an empty or overlong body", async () => {
    db.agent.findUnique.mockResolvedValueOnce(null);
    await expect(sendAgentMessage(owner, "missing", { body: "Hi" })).resolves.toMatchObject({ ok: false });
    db.agent.findUnique.mockResolvedValueOnce({ ...agentRow, revokedAt: new Date() });
    await expect(sendAgentMessage(owner, "a1", { body: "Hi" })).resolves.toEqual({ ok: false, error: "That agent is revoked." });
    await expect(sendAgentMessage(owner, "a1", { body: "   " })).resolves.toMatchObject({ ok: false });
    await expect(sendAgentMessage(owner, "a1", { body: "x".repeat(2001) })).resolves.toMatchObject({ ok: false });
    expect(db.agentMessage.create).not.toHaveBeenCalled();
  });
});

describe("setAgentInstructions (#605)", () => {
  it("saves the owner's brief, and blank clears it", async () => {
    await expect(setAgentInstructions(owner, "a1", { instructions: " Use the staging URL. " })).resolves.toEqual({ ok: true });
    expect(db.agent.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { instructions: "Use the staging URL." } });
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "agent.instructions_changed", actorUserId: "owner" }),
    });

    await setAgentInstructions(owner, "a1", { instructions: "  " });
    expect(db.agent.update).toHaveBeenLastCalledWith({ where: { id: "a1" }, data: { instructions: null } });
  });

  it("is owner-only and capped at 4000 characters", async () => {
    await expect(setAgentInstructions(admin, "a1", { instructions: "x" })).resolves.toMatchObject({ ok: false });
    await expect(setAgentInstructions(stranger, "a1", { instructions: "x" })).resolves.toMatchObject({ ok: false });
    await expect(
      setAgentInstructions(owner, "a1", { instructions: "x".repeat(AGENT_INSTRUCTIONS_MAX + 1) }),
    ).resolves.toMatchObject({ ok: false });
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it("reads the brief back for /agents/me", async () => {
    await expect(readAgentInstructions("a1")).resolves.toBe("Use staging.");
    db.agent.findUnique.mockResolvedValueOnce({ instructions: null });
    await expect(readAgentInstructions("a1")).resolves.toBeNull();
  });
});

describe("listAgentThread (#605)", () => {
  const at = (minute: number) => new Date(`2026-10-20T10:${String(minute).padStart(2, "0")}:00Z`);

  beforeEach(() => {
    db.agentQuestion.findMany.mockResolvedValue([
      { id: "q2", body: "[blocker] CI is red", answer: null, answeredAt: null, createdAt: at(3), bug: null },
      { id: "q1", body: "Which branch?", answer: "main", answeredAt: at(2), createdAt: at(1), bug: { id: "b1", title: "Header" } },
    ]);
    db.agentMessage.findMany.mockResolvedValue([
      { id: "m2", body: "Then stop.", readAt: null, createdAt: at(4), fromUser: { id: "owner", name: "Ada" } },
      { id: "m1", body: "Focus on desktop.", readAt: at(5), createdAt: at(2), fromUser: { id: "owner", name: "Ada" } },
    ]);
  });

  it("shows the owner questions and messages together, oldest first", async () => {
    const thread = await listAgentThread(owner, "a1");
    expect(thread?.isOwner).toBe(true);
    expect(thread?.instructions).toBe("Use staging.");
    expect(thread?.entries.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      "question:q1", "message:m1", "question:q2", "message:m2",
    ]);
    expect(thread?.entries[2]).toMatchObject({ body: "CI is red" });
  });

  it("shows an admin the messages only, and nobody else anything", async () => {
    const thread = await listAgentThread(admin, "a1");
    expect(thread?.isOwner).toBe(false);
    expect(thread?.instructions).toBeNull();
    expect(db.agentQuestion.findMany).not.toHaveBeenCalled();
    expect(thread?.entries.map((entry) => entry.id)).toEqual(["m1", "m2"]);

    await expect(listAgentThread(stranger, "a1")).resolves.toBeNull();
  });
});

describe("markMessagesRead (#605)", () => {
  it("marks the messages behind the inbox items just read", async () => {
    const readAt = new Date();
    db.agentInboxItem.findMany.mockResolvedValue([{ payload: { messageId: "m1" } }, { payload: {} }]);
    await markMessagesRead("a1", readAt);
    expect(db.agentInboxItem.findMany).toHaveBeenCalledWith({
      where: { agentId: "a1", kind: "message", readAt }, select: { payload: true },
    });
    expect(db.agentMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1"] }, agentId: "a1", readAt: null }, data: { readAt },
    });
  });

  it("does nothing when no message was read", async () => {
    await markMessagesRead("a1", new Date());
    expect(db.agentMessage.updateMany).not.toHaveBeenCalled();
  });
});

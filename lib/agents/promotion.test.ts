import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agent: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  issueValidation: { findMany: vi.fn() },
  issueClaim: { count: vi.fn() },
  agentAuditEvent: { create: vi.fn(), findMany: vi.fn() },
  membership: { findUnique: vi.fn() },
  project: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const auth = vi.hoisted(() => ({ requireSuperAdmin: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ requireSuperAdmin: auth.requireSuperAdmin }));

import {
  EARNED_REVIEWER_VALIDATIONS,
  SILENCE_DEMOTION_RELEASES,
  demoteFromSilence,
  grantLevelByAdmin,
  promoteEarnedReviewer,
  runLevelPromotions,
  silenceReleases,
  standingValidations,
} from "./promotion";

const admin = { id: "admin-1", role: "user" as const };
const owner = { id: "owner-1", role: "user" as const };

let nextValId = 1;

/** One validation row, independent (standing) by default. */
function validation(overrides: Record<string, unknown> = {}) {
  return {
    id: `val-${nextValId++}`,
    agent: { id: "a1", ownerUserId: "owner-1" },
    bug: {
      createdByAgentId: null,
      beneficiaryUserId: "someone-else",
      createdByAgent: null,
      claims: [],
    },
    ...overrides,
  };
}

function agentRow(overrides: Record<string, unknown> = {}) {
  return { id: "a1", tenantId: "t1", level: "contributor", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  nextValId = 1;
  db.agent.findUnique.mockResolvedValue(agentRow());
  db.agent.findMany.mockResolvedValue([]);
  db.agent.update.mockResolvedValue({});
  db.issueValidation.findMany.mockResolvedValue([]);
  db.issueClaim.count.mockResolvedValue(0);
  db.agentAuditEvent.create.mockResolvedValue({});
  db.agentAuditEvent.findMany.mockResolvedValue([]);
  db.membership.findUnique.mockResolvedValue({ role: "member" });
  db.project.findUnique.mockResolvedValue({ tenantId: "t1" });
  auth.requireSuperAdmin.mockResolvedValue({ id: "super", role: "super_admin" });
});

describe("standingValidations (#451)", () => {
  it("counts only the validations the independence rule still allows", async () => {
    db.issueValidation.findMany.mockResolvedValue([
      validation(),
      // Same owner as the beneficiary: not independent.
      validation({ bug: { createdByAgentId: null, beneficiaryUserId: "owner-1", createdByAgent: null, claims: [] } }),
    ]);

    expect(await standingValidations("a1")).toBe(1);
  });

  it("skips a validation by the agent that filed the issue", async () => {
    db.issueValidation.findMany.mockResolvedValue([
      validation(),
      validation({ bug: { createdByAgentId: "a1", beneficiaryUserId: "x", createdByAgent: null, claims: [] } }),
    ]);

    expect(await standingValidations("a1")).toBe(1);
  });

  it("excludes validations that were undone by an admin (#623)", async () => {
    db.issueValidation.findMany.mockResolvedValue([
      validation({ id: "val-1" }),
      validation({ id: "val-2" }),
      validation({ id: "val-3" }),
    ]);
    db.agentAuditEvent.findMany.mockResolvedValue([
      { payload: { validationId: "val-2" } },
    ]);

    expect(await standingValidations("a1")).toBe(2);
    expect(db.agentAuditEvent.findMany).toHaveBeenCalledWith({
      where: { agentId: "a1", action: "issue.validated", undoneAt: { not: null } },
      select: { payload: true },
    });
  });
});

describe("promoteEarnedReviewer (#451)", () => {
  it("does not promote on the ninth standing validation", async () => {
    db.issueValidation.findMany.mockResolvedValue(
      Array.from({ length: EARNED_REVIEWER_VALIDATIONS - 1 }, () => validation()),
    );

    const result = await promoteEarnedReviewer("a1");

    expect(result).toEqual({ ok: true, changed: false, standing: 9 });
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it("promotes a contributor to reviewer once at ten", async () => {
    db.issueValidation.findMany.mockResolvedValue(
      Array.from({ length: EARNED_REVIEWER_VALIDATIONS }, () => validation()),
    );

    const result = await promoteEarnedReviewer("a1");

    expect(result).toEqual({ ok: true, changed: true, standing: 10 });
    expect(db.agent.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { level: "reviewer" } });
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "agent.promoted",
          payload: { from: "contributor", to: "reviewer", validations: 10 },
        }),
      }),
    );
  });

  it("does not promote an agent when undone validations drop the count below ten (#623)", async () => {
    db.issueValidation.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => validation({ id: `val-${i + 1}` })),
    );
    db.agentAuditEvent.findMany.mockResolvedValue([
      { payload: { validationId: "val-1" } },
      { payload: { validationId: "val-4" } },
      { payload: { validationId: "val-7" } },
    ]);

    const result = await promoteEarnedReviewer("a1");

    expect(result).toEqual({ ok: true, changed: false, standing: 7 });
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it("leaves an agent already at reviewer or above alone", async () => {
    db.agent.findUnique.mockResolvedValue(agentRow({ level: "reviewer" }));

    const result = await promoteEarnedReviewer("a1");

    expect(result).toEqual({ ok: true, changed: false, standing: 0 });
    expect(db.issueValidation.findMany).not.toHaveBeenCalled();
    expect(db.agent.update).not.toHaveBeenCalled();
  });
});

describe("silenceReleases / demoteFromSilence (#451)", () => {
  it("counts silence and missed-deadline releases inside the seven-day window", async () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    await silenceReleases("a1", undefined, now);

    const where = db.issueClaim.count.mock.calls[0][0].where;
    expect(where.releaseReason).toEqual({ in: ["silence", "deadline"] });
    expect(where.releasedAt.gte).toEqual(new Date("2026-10-12T12:00:00.000Z"));
  });

  it("does not demote on two silence releases", async () => {
    db.issueClaim.count.mockResolvedValue(SILENCE_DEMOTION_RELEASES - 1);

    const result = await demoteFromSilence("a1");

    expect(result).toEqual({ ok: true, changed: false, releases: 2 });
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it("demotes a contributor to observer at three silence releases", async () => {
    db.issueClaim.count.mockResolvedValue(SILENCE_DEMOTION_RELEASES);

    const result = await demoteFromSilence("a1");

    expect(result).toEqual({ ok: true, changed: true, releases: 3 });
    expect(db.agent.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { level: "observer" } });
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "agent.demoted",
          payload: { from: "contributor", to: "observer", reason: "silence", releases: 3 },
        }),
      }),
    );
  });

  it("never demotes a reviewer (or a merger)", async () => {
    db.agent.findUnique.mockResolvedValue(agentRow({ level: "merger" }));

    const result = await demoteFromSilence("a1");

    expect(result).toEqual({ ok: true, changed: false, releases: 0 });
    expect(db.issueClaim.count).not.toHaveBeenCalled();
    expect(db.agent.update).not.toHaveBeenCalled();
  });
});

describe("grantLevelByAdmin (#451)", () => {
  it("rejects an owner who is not a tenant admin granting merger", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "member" });

    const result = await grantLevelByAdmin({ actor: owner, agentId: "a1", level: "merger", reason: "trusted" });

    expect(result.ok).toBe(false);
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it("lets a tenant admin grant merger, recording the admin and the reason", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "admin" });

    const result = await grantLevelByAdmin({ actor: admin, agentId: "a1", level: "merger", reason: "field lead" });

    expect(result).toEqual({ ok: true, changed: true });
    expect(db.agent.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { level: "merger" } });
    expect(db.agentAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "agent.level_changed",
          actorUserId: "admin-1",
          payload: expect.objectContaining({ to: "merger", reason: "field lead" }),
        }),
      }),
    );
  });

  it("requires a reason to make a merger", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "admin" });

    const result = await grantLevelByAdmin({ actor: admin, agentId: "a1", level: "merger", reason: "  " });

    expect(result.ok).toBe(false);
    expect(db.agent.update).not.toHaveBeenCalled();
  });

  it("lets a tenant admin grant reviewer by hand", async () => {
    db.membership.findUnique.mockResolvedValue({ role: "owner" });

    const result = await grantLevelByAdmin({ actor: admin, agentId: "a1", level: "reviewer", reason: "earned elsewhere" });

    expect(result).toEqual({ ok: true, changed: true });
    expect(db.agent.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { level: "reviewer" } });
  });
});

describe("runLevelPromotions (#451)", () => {
  it("sweeps the project's agents for promotions and silence demotions", async () => {
    db.agent.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    db.issueValidation.findMany.mockResolvedValue([]);
    db.issueClaim.count.mockResolvedValue(SILENCE_DEMOTION_RELEASES);

    const result = await runLevelPromotions("project-1");

    expect(auth.requireSuperAdmin).toHaveBeenCalled();
    expect(result).toEqual({ promoted: 0, demoted: 2 });
  });

  it("throws when the project does not exist", async () => {
    db.project.findUnique.mockResolvedValue(null);
    await expect(runLevelPromotions("nope")).rejects.toThrow("Project not found.");
  });
});

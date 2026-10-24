import { beforeEach, describe, expect, it, vi } from "vitest";

// #600: these tests are about the actions themselves; the event is checked separately.
const publishWebEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/agent-api/web-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-api/web-events")>()),
  publishWebEvent,
}));

// #425: run as a member of the Zedu tenant.
vi.mock("@/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant-context")>()),
  currentTenantIdFor: vi.fn(async () => "tenant-zedu"),
  defaultProjectIdFor: vi.fn(async () => "project-zedu"),
  tenantIdForUser: vi.fn(async () => "tenant-zedu"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyLater: vi.fn() }));
vi.mock("@/lib/session-user", () => ({ resolveSessionUserId: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1", name: "Alice", role: "admin" }),
}));
vi.mock("@/lib/tenant-access", () => ({
  currentTenantAccess: vi.fn(async () => ({
    tenantId: "tenant-zedu",
    tenantName: "Zedu",
    tenantSlug: "zedu",
    membershipRole: "member",
    admin: false,
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bug: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    bugActivity: {
      create: vi.fn(),
    },
    issueWatch: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        bug: { update: vi.fn() },
        bugActivity: { create: vi.fn() },
        bugRevision: { create: vi.fn() },
        issueWatch: { createMany: vi.fn(), upsert: vi.fn() },
        $queryRaw: vi.fn().mockResolvedValue([{ title: "Old title", description: "Old description" }]),
      };
      return fn(tx);
    }),
  },
}));

import { prisma } from "@/lib/prisma";
import {
  ACTION_RATE_LIMITS,
  RATE_LIMIT_MESSAGE,
  resetRateLimits,
} from "@/lib/rate-limit";
import { TICKET_ASSIGN_ERRORS } from "@/lib/ticket-assignment";
import { editBugContentAction, selfAssignBugAction } from "./issues";

const mockBugFindUnique = vi.mocked(prisma.bug.findUnique) as unknown as ReturnType<typeof vi.fn>;

describe("action rate limits on bug edits and self-assign (#350)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
  });

  describe("editBugContentAction rate limiting", () => {
    it("returns error when edit limit is exceeded", async () => {
      mockBugFindUnique.mockResolvedValue({
        id: "bug-1",
        title: "Original Title",
        description: "Original Description",
        reporterId: "user-1",
        isDeleted: false,
      });

      const max = ACTION_RATE_LIMITS.editBug.max;
      for (let i = 0; i < max; i++) {
        const formData = new FormData();
        formData.set("title", `Title ${i}`);
        formData.set("description", `Description ${i}`);
        const result = await editBugContentAction("bug-1", formData);
        expect(result).toEqual({ ok: true });
      }

      const formData = new FormData();
      formData.set("title", "Too fast title");
      formData.set("description", "Too fast description");
      const blocked = await editBugContentAction("bug-1", formData);
      expect(blocked).toEqual({ error: RATE_LIMIT_MESSAGE });
    });
  });

  describe("selfAssignBugAction", () => {
    it("refuses to take an issue before an agent claim", async () => {
      mockBugFindUnique.mockResolvedValue({
        id: "bug-1",
        title: "Test Bug",
        assigneeId: null,
        isDeleted: false,
        assignee: null,
      });

      const result = await selfAssignBugAction("bug-1", true);
      expect(result).toEqual({ error: TICKET_ASSIGN_ERRORS.needsAgentClaim });
      expect(prisma.bug.update).not.toHaveBeenCalled();
    });
  });
});

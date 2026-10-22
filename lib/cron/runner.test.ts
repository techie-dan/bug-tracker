import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSweepOffers = vi.hoisted(() => vi.fn());
const mockSweepClaims = vi.hoisted(() => vi.fn());
const mockSweepPromotions = vi.hoisted(() => vi.fn());
const mockDispatch = vi.hoisted(() => vi.fn());
const mockPruneAgent = vi.hoisted(() => vi.fn());
const mockSweepAttachments = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: mockLogger }));
vi.mock("@/lib/agent-api/offer", () => ({ sweepExpiredOffers: mockSweepOffers }));
vi.mock("@/lib/agent-api/availability", () => ({ sweepStaleClaims: mockSweepClaims }));
vi.mock("@/lib/agents/promotion", () => ({ sweepLevelPromotions: mockSweepPromotions }));
vi.mock("@/lib/webhooks/deliver", () => ({ dispatchDueDeliveries: mockDispatch }));
vi.mock("@/lib/agent-retention", () => ({ pruneAgentRows: mockPruneAgent }));
vi.mock("@/lib/attachment-retention", () => ({ sweepOrphanedAttachments: mockSweepAttachments }));

import {
  runPlatformSweeps,
  recordSweepFailure,
  recordSweepSuccess,
  getConsecutiveFailures,
  resetConsecutiveFailures,
  FAILURE_ALERT_THRESHOLD,
} from "./runner";

describe("runPlatformSweeps (#647)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConsecutiveFailures();

    mockSweepOffers.mockResolvedValue({ expired: 2 });
    mockSweepClaims.mockResolvedValue({ released: 1, offered: 1 });
    mockSweepPromotions.mockResolvedValue({ promoted: 1, demoted: 0 });
    mockDispatch.mockResolvedValue(4);
    mockPruneAgent.mockResolvedValue({
      pairings: 1,
      deliveries: 2,
      events: 3,
      auditEvents: 4,
      rateLimitHits: 5,
    });
    mockSweepAttachments.mockResolvedValue({
      unlinked: 6,
      deletedParents: 7,
      total: 13,
    });
  });

  it("runs all sweeps, logs the counts, and returns structured result", async () => {
    const result = await runPlatformSweeps();

    expect("skipped" in result).toBe(false);
    if (!("skipped" in result)) {
      expect(result.sweeps.offers).toEqual({ status: "ok", expired: 2 });
      expect(result.sweeps.claims).toEqual({ status: "ok", released: 1, offered: 1 });
      expect(result.sweeps.promotions).toEqual({ status: "ok", promoted: 1, demoted: 0 });
      expect(result.sweeps.deliveries).toEqual({ status: "ok", processed: 4 });
      expect(result.sweeps.retention).toEqual({
        status: "ok",
        pruned: {
          pairings: 1,
          deliveries: 2,
          events: 3,
          auditEvents: 4,
          rateLimitHits: 5,
          unlinkedUploads: 6,
          deletedParentAttachments: 7,
        },
      });
      expect(result.timestamp).toBeDefined();
    }

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("[cron] Platform sweeps finished"),
      expect.any(Object),
    );
  });

  it("isolates errors per sweep so one failing sweep does not abort the others", async () => {
    mockDispatch.mockRejectedValueOnce(new Error("Network timeout during webhooks"));

    const result = await runPlatformSweeps();

    expect("skipped" in result).toBe(false);
    if (!("skipped" in result)) {
      expect(result.sweeps.offers).toEqual({ status: "ok", expired: 2 });
      expect(result.sweeps.claims).toEqual({ status: "ok", released: 1, offered: 1 });
      expect(result.sweeps.promotions).toEqual({ status: "ok", promoted: 1, demoted: 0 });
      expect(result.sweeps.deliveries).toEqual({
        status: "error",
        error: "Network timeout during webhooks",
      });
      expect(result.sweeps.retention.status).toBe("ok");
    }
  });

  it("alerts with [CRON_ALERT] when a sweep fails repeatedly at or above threshold", async () => {
    const err = new Error("Database deadlocked");

    recordSweepFailure("claims", err);
    expect(getConsecutiveFailures("claims")).toBe(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "[cron] Sweep 'claims' failed:",
      err,
    );

    recordSweepFailure("claims", err);
    expect(getConsecutiveFailures("claims")).toBe(2);

    // 3rd failure reaches threshold
    recordSweepFailure("claims", err);
    expect(getConsecutiveFailures("claims")).toBe(FAILURE_ALERT_THRESHOLD);
    expect(mockLogger.error).toHaveBeenCalledWith(
      `[CRON_ALERT] Sweep 'claims' failed ${FAILURE_ALERT_THRESHOLD} consecutive times:`,
      err,
    );

    // Success resets count
    recordSweepSuccess("claims");
    expect(getConsecutiveFailures("claims")).toBe(0);
  });
});

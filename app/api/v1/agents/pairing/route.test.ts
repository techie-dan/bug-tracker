import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const startPairing = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/rate-limit", () => ({ consumePairingLimit: vi.fn(async () => null) }));
vi.mock("@/lib/agents/pairing", () => ({
  PAIRING_POLL_INTERVAL: 5,
  pairingApprovalPath: (code: string) => `/settings/agents/pair?code=${encodeURIComponent(code)}`,
  startPairing,
}));
vi.mock("@/lib/site-url", () => ({ absoluteUrl: (path: string) => `https://ziki.dev${path}` }));

import { POST } from "./route";

describe("POST /api/v1/agents/pairing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a link the signed-in owner can approve", async () => {
    startPairing.mockResolvedValue({
      ok: true,
      userCode: "KX7P-2MQD",
      deviceCode: "device-secret",
      expiresAt: new Date("2026-10-20T12:15:00.000Z"),
    });
    const response = await POST(
      new NextRequest("https://ziki.dev/api/v1/agents/pairing", {
        method: "POST",
        body: JSON.stringify({ name: "Claude", model: "Claude" }),
      }),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      user_code: "KX7P-2MQD",
      device_code: "device-secret",
      verification_uri: "https://ziki.dev/settings/agents/pair",
      verification_uri_complete: "https://ziki.dev/settings/agents/pair?code=KX7P-2MQD",
      interval: 5,
      message: expect.stringContaining("Open verification_uri_complete in the owner's browser"),
    });
    expect(startPairing).toHaveBeenCalledWith({ name: "Claude", model: "Claude", level: undefined });
  });

  it("passes the requested level through (#425)", async () => {
    startPairing.mockResolvedValue({ ok: true, userCode: "KX7P-2MQD", deviceCode: "d", expiresAt: new Date() });
    await POST(
      new NextRequest("https://ziki.dev/api/v1/agents/pairing", {
        method: "POST",
        body: JSON.stringify({ name: "Claude", level: "dispatcher" }),
      }),
    );
    expect(startPairing).toHaveBeenCalledWith({ name: "Claude", model: undefined, level: "dispatcher" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const collectPairing = vi.hoisted(() => vi.fn());
const consumePairingLimit = vi.hoisted(() => vi.fn(async () => null as number | null));
vi.mock("@/lib/agents/rate-limit", () => ({ consumePairingLimit }));
vi.mock("@/lib/agents/pairing", () => ({ collectPairing }));
vi.mock("@/lib/feature-flags", () => ({ isAgentPlatformEnabled: () => true }));

import { POST } from "./route";

function call(body: string) {
  return POST(new NextRequest("https://ziki.dev/api/v1/agents/pairing/token", { method: "POST", body }));
}

describe("POST /api/v1/agents/pairing/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumePairingLimit.mockResolvedValue(null);
  });

  it("returns the key once, with the agent's level (#429)", async () => {
    collectPairing.mockResolvedValue({
      status: "issued",
      key: { agentId: "agent_1", name: "Ada's Claude", level: "reviewer", rawKey: "ziki_raw", prefix: "ziki_raw" },
      projectId: "project_1",
    });
    const response = await call(JSON.stringify({ device_code: "d".repeat(24) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      api_key: "ziki_raw",
      agent: { id: "agent_1", name: "Ada's Claude", level: "reviewer" },
      project_id: "project_1",
    });
  });

  it("treats a malformed body as an unknown device code", async () => {
    collectPairing.mockResolvedValue({ status: "invalid" });
    const response = await call("not json");
    expect(collectPairing).toHaveBeenCalledWith(undefined);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("answers authorization_pending until the owner approves", async () => {
    collectPairing.mockResolvedValue({ status: "pending" });
    const response = await call(JSON.stringify({ device_code: "d".repeat(24) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "authorization_pending" });
  });

  it("reports slow_down when polled too fast", async () => {
    consumePairingLimit.mockResolvedValue(7);
    const response = await call(JSON.stringify({ device_code: "d".repeat(24) }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(collectPairing).not.toHaveBeenCalled();
  });

  it("does not hide a database error as an answer", async () => {
    collectPairing.mockRejectedValue(new Error("temporary database error"));
    await expect(call(JSON.stringify({ device_code: "d".repeat(24) }))).rejects.toThrow("temporary database error");
  });
});

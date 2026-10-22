import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.hoisted(() => vi.fn());
const exportUserData = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-helpers", () => ({ requireUser }));
vi.mock("@/lib/user-data-export", () => ({ exportUserData }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { GET } from "./route";

describe("GET /api/user/export (#571)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with exported user data and attachment header", async () => {
    requireUser.mockResolvedValue({ id: "user-test" });
    const mockExport = {
      user: { id: "user-test", name: "Tester", email: "test@example.com" },
      exportedAt: "2026-10-20T20:00:00.000Z",
      issues: [],
      comments: [],
      votes: [],
      points: [],
    };
    exportUserData.mockResolvedValue(mockExport);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="data-export-user-test.json"',
    );

    const body = await response.json();
    expect(body).toEqual(mockExport);
    expect(exportUserData).toHaveBeenCalledWith(expect.anything(), "user-test");
  });

  it("returns 500 if export throws", async () => {
    requireUser.mockResolvedValue({ id: "user-error" });
    exportUserData.mockRejectedValue(new Error("Database error"));

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Failed to export user data" });
  });
});

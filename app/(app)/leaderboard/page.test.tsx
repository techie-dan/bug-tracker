import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const leaderboard = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
);

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn(async () => ({ id: "ann", role: "user" })) }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantIdFor: vi.fn(async () => "tenant-acme") }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/points/leaderboard", () => ({
  DEFAULT_LEADERBOARD_LIMIT: 50,
  paginatedTenantLeaderboard: leaderboard,
}));

import LeaderboardPage from "./page";

const row = (rank: number) => ({
  userId: `u${rank}`,
  name: `Person ${rank}`,
  image: null,
  points: 100 - rank,
  solvedTasks: 1,
  rank,
});

async function render(params: Record<string, string>) {
  return renderToStaticMarkup((await LeaderboardPage({ searchParams: Promise.resolve(params) })) as ReactElement);
}

describe("leaderboard pagination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a page past the end to the last page, keeping the page size", async () => {
    // 25 people at 10 a page: 3 pages, so page 99 has no rows.
    leaderboard.mockResolvedValue({ entries: [], total: 25, page: 99, limit: 10, totalPages: 3 });
    await expect(render({ page: "99", limit: "10" })).rejects.toMatchObject({ url: "/leaderboard?page=3&limit=10" });
    expect(redirect).toHaveBeenCalledWith("/leaderboard?page=3&limit=10");
  });

  it("keeps \"No points yet\" for a leaderboard that really is empty", async () => {
    leaderboard.mockResolvedValue({ entries: [], total: 0, page: 1, limit: 50, totalPages: 1 });
    const html = await render({});
    expect(html).toContain("No points yet");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("doesn't redirect an out-of-range page when there is nothing to page through", async () => {
    leaderboard.mockResolvedValue({ entries: [], total: 0, page: 5, limit: 50, totalPages: 1 });
    expect(await render({ page: "5" })).toContain("No points yet");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renders a middle page with Previous and Next built the same way", async () => {
    leaderboard.mockResolvedValue({ entries: [row(11), row(12)], total: 25, page: 2, limit: 10, totalPages: 3 });
    const html = await render({ page: "2", limit: "10" });
    expect(html).toContain("Person 11");
    expect(html).toContain("Showing 11–20 of 25");
    expect(html).toContain('href="/leaderboard?page=1&amp;limit=10"');
    expect(html).toContain('href="/leaderboard?page=3&amp;limit=10"');
    expect(html).not.toContain("No points yet");
  });

  it("marks Previous as disabled on the first page", async () => {
    leaderboard.mockResolvedValue({ entries: [row(1)], total: 25, page: 1, limit: 10, totalPages: 3 });
    const html = await render({ limit: "10" });
    expect(html).toMatch(/<span aria-disabled="true"[^>]*>Previous<\/span>/);
  });
});

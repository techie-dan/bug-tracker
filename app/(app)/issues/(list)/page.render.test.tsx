import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/**
 * Renders the whole issue list with a small fake database, so the layout
 * changes from the Oct 20 call (#1054–#1063) are checked on real markup.
 */

const count = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
const groupBy = vi.hoisted(() => vi.fn(async () => []));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/issues",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "dave" } })) }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: vi.fn(async () => ({ id: "dave", role: "user" })) }));
vi.mock("@/lib/tenant-access", () => ({ currentTenantAccess: vi.fn(async () => ({ membershipRole: "member" })) }));
vi.mock("@/lib/project-context", () => ({ activeProjectIdFor: vi.fn(async () => "project-acme") }));
vi.mock("@/lib/lookups", () => ({
  getIssueTypes: vi.fn(async () => []),
  getPlatforms: vi.fn(async () => [
    { id: "cat-web", name: "Web", isActive: true },
    { id: "cat-mobile", name: "Mobile", isActive: true },
    { id: "cat-old", name: "Desktop", isActive: false },
  ]),
}));
vi.mock("@/lib/tenant-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tenant-context")>()),
  currentTenantIdFor: vi.fn(async () => "tenant-acme"),
}));
vi.mock("@/lib/issue-stage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/issue-stage")>()),
  openIssueStages: vi.fn(async () => new Map([["bug-1", "reported"]])),
}));
vi.mock("@/lib/voter-summaries", () => ({
  fetchVoterSummaries: vi.fn(async () =>
    new Map([
      [
        "bug-1",
        {
          likes: { count: 2, voters: [{ id: "a", name: "Ann", image: null }, { id: "b", name: "Ben", image: null }] },
          dislikes: { count: 1, voters: [{ id: "c", name: "Cy", image: null }] },
        },
      ],
    ]),
  ),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn(async () => ({ slug: "acme-web", name: "Acme Web", goal: null })) },
    bug: { count, findMany, groupBy },
    milestone: { findMany: vi.fn(async () => []) },
    projectArea: { findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn(async () => ({ keyboardShortcuts: true })) },
  },
}));

import BugsPage from "./page";

const BUG = {
  id: "bug-1",
  number: 7,
  title: "Login button does nothing",
  status: "open",
  severity: "high",
  voteCount: 2,
  proofLinks: ["https://github.com/acme/web/pull/1", "https://github.com/acme/web/pull/2"],
  isDeleted: false,
  isBoosted: false,
  duplicateOf: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  updatedAt: new Date("2026-10-20T10:00:00Z"),
  type: null,
  reporter: { name: "Rita Reporter", role: "user", image: null },
  assignee: { name: "Bob Builder", role: "user", image: null },
  category: { id: "cat-web", name: "Web" },
  area: null,
  votes: [],
  _count: { comments: 3, attachments: 1 },
};

async function renderList(params: Record<string, string> = {}) {
  const page = (await BugsPage({ searchParams: Promise.resolve(params) })) as ReactElement;
  return renderToStaticMarkup(page);
}

beforeEach(() => {
  vi.clearAllMocks();
  count.mockResolvedValue(1);
  findMany.mockResolvedValue([BUG]);
});

describe("issue list layout", () => {
  it("renders the list with the project as its heading (#1063)", async () => {
    const html = await renderList();
    expect(html).toContain("Login button does nothing");
    expect(html).toMatch(/<h1[^>]*>(<!-- -->)?Acme Web<\/h1>/);
  });

  it("has no second New issue button; the header has it (#1057)", async () => {
    const html = await renderList();
    expect(html).not.toContain('href="/issues/new"');
  });

  it("keeps the empty state free of a second New issue button (#1057)", async () => {
    // The search matches nothing, but the tracker itself isn't empty.
    count.mockImplementation(async (args: { where?: { OR?: unknown } }) => (args?.where?.OR ? 0 : 5));
    findMany.mockResolvedValue([]);
    const html = await renderList({ q: "nothing matches" });
    expect(html).toContain("No issues match these filters.");
    expect(html).not.toContain('href="/issues/new"');
  });

  it("welcomes a new, empty project even when the workspace has issues elsewhere", async () => {
    // Other projects in tenant-acme have 5 issues; project-acme has none.
    count.mockImplementation(async (args: { where?: { projectId?: unknown } }) =>
      args?.where?.projectId === "project-acme" ? 0 : 5,
    );
    findMany.mockResolvedValue([]);
    const html = await renderList();
    expect(html).toContain("No issues yet");
    expect(html).not.toContain("No issues match these filters.");
    const firstRunCount = count.mock.calls.find(([args]) => args?.where?.isDeleted === false && !args?.where?.status);
    expect(firstRunCount?.[0].where).toMatchObject({ tenantId: "tenant-acme", projectId: "project-acme" });
  });

  it("says no issues match when the project has issues but the filters hide them", async () => {
    count.mockImplementation(async (args: { where?: { severity?: unknown } }) => (args?.where?.severity ? 0 : 3));
    findMany.mockResolvedValue([]);
    const html = await renderList({ severity: "critical" });
    expect(html).toContain("No issues match these filters.");
    expect(html).not.toContain("No issues yet");
  });

  it("has no stage sidebar beside the list (#1054)", async () => {
    const html = await renderList();
    expect(html).not.toContain('aria-label="Issue stages"');
    expect(html).not.toContain("lg:w-56");
  });

  it("still filters by ?stage= from old links (#1054)", async () => {
    await renderList({ stage: "reported" });
    const listQuery = findMany.mock.calls.at(-1)![0];
    expect(listQuery.where.id).toEqual({ in: ["bug-1"] });
  });

  it("is one centred column without the stats card (#1056)", async () => {
    const html = await renderList();
    expect(html).not.toContain("Total issues");
    expect(html).toMatch(/^<div class="mx-auto w-full max-w-3xl /);
    // The four stats counts are no longer queried.
    const statusOnly = count.mock.calls.filter(([args]) => args?.where?.status === "in_progress");
    expect(statusOnly).toHaveLength(0);
  });

  it("puts platform tabs above the list, with counts (#1055)", async () => {
    groupBy.mockResolvedValue([
      { categoryId: "cat-web", _count: { _all: 4 } },
      { categoryId: "cat-mobile", _count: { _all: 2 } },
      { categoryId: null, _count: { _all: 1 } },
    ] as never);
    const html = await renderList({ platform: "cat-web", page: "2", q: "login" });

    const nav = html.match(/<nav aria-label="Platforms"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const tabs = [...nav.matchAll(/<a [^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)<span[^>]*>(\d+)<\/span><\/a>/g)].map((m) => `${m[1].trim()} ${m[2]}`);
    // Active platforms only (not the inactive Desktop), and Resolved tab with count.
    expect(tabs).toEqual(["All 7", "Web 4", "Mobile 2", "Resolved 1"]);
    expect(nav).toMatch(/aria-current="page"[^>]*href="\/issues\?q=login&amp;platform=cat-web"/);
    // Choosing a tab keeps the search, drops paging, and swaps the platform.
    expect(nav).toContain('href="/issues?q=login&amp;platform=cat-mobile"');
    expect(nav).toContain('href="/issues?q=login"');
    expect(nav).toContain('href="/issues?q=login&amp;status=resolved"');
    expect(nav).not.toContain("No platform");

    // The counts ignore the current platform, so every tab is honest.
    const tabQuery = (groupBy.mock.calls as unknown as [{ where: Record<string, unknown> }][]).at(-1)![0];
    expect(tabQuery.where).not.toHaveProperty("categoryId");
    // The list itself is still narrowed to the chosen platform.
    expect(findMany.mock.calls.at(-1)![0].where.categoryId).toBe("cat-web");
  });

  it("activates the Resolved tab when filtering by status=resolved (#473)", async () => {
    groupBy.mockResolvedValue([
      { categoryId: "cat-web", _count: { _all: 4 } },
      { categoryId: "cat-mobile", _count: { _all: 2 } },
    ] as never);
    const html = await renderList({ status: "resolved" });
    const nav = html.match(/<nav aria-label="Platforms"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(nav).toMatch(/aria-current="page"[^>]*href="\/issues\?status=resolved"/);
    expect(nav).toContain('href="/issues"');
    expect(nav).toContain('href="/issues?platform=cat-web"');
  });

  it("shows no tabs when the project has no platforms to choose between (#1055)", async () => {
    groupBy.mockResolvedValue([] as never);
    const { getPlatforms } = await import("@/lib/lookups");
    vi.mocked(getPlatforms).mockResolvedValueOnce([]);
    const html = await renderList();
    expect(html).not.toContain('aria-label="Platforms"');
  });

  it("hides resolved and closed issues by default, and says how many (#1058)", async () => {
    count.mockImplementation(async (args: { where?: { status?: unknown } }) =>
      JSON.stringify(args?.where?.status) === JSON.stringify({ in: ["resolved", "closed"] }) ? 4 : 1,
    );
    const html = await renderList({ q: "login", page: "3" });
    expect(findMany.mock.calls.at(-1)![0].where.status).toEqual({ in: ["open", "in_progress"] });
    expect(html).toContain('href="/issues?q=login&amp;resolved=1"');
    expect(html).toContain("Show 4 resolved");
  });

  it("shows everything with ?resolved=1, and offers to hide them again (#1058)", async () => {
    const html = await renderList({ resolved: "1" });
    expect(findMany.mock.calls.at(-1)![0].where).not.toHaveProperty("status");
    expect(html).toContain("Hide resolved");
    expect(html).toContain('href="/issues"');
  });

  it("lets an explicit status filter win over the default (#1058)", async () => {
    const html = await renderList({ status: "resolved" });
    expect(findMany.mock.calls.at(-1)![0].where.status).toBe("resolved");
    expect(html).not.toContain("Show 0 resolved");
    expect(html).not.toContain("Hide resolved");
  });

  it("shows the vote count once and no proof-link count in rows (#1060)", async () => {
    const html = await renderList();
    expect(html).not.toContain("🔗");
    expect(html).not.toContain("linked proof");
    expect(html).not.toContain("👍");
    expect(html).not.toContain("👎");
    // The voters' faces aren't repeated under the row.
    expect(html).not.toContain(">Ann<");
    expect(findMany.mock.calls.at(-1)![0].select).not.toHaveProperty("proofLinks");
  });

  it("shows the assignee as a face only, and a short updated date (#1061)", async () => {
    const html = await renderList();
    // The name is only in the tooltip and for screen readers.
    expect(html).toContain('title="Assigned to Bob Builder"');
    expect(html).toContain('<span class="sr-only">Assigned to Bob Builder</span>');
    expect(html).not.toContain("max-w-[10rem] truncate");
    // "Updated" means updatedAt (Oct 20), not when it was opened (Oct 1).
    expect(html).toMatch(/<time dateTime="2026-10-20T10:00:00.000Z" title="Updated Oct 20, 2026/);
    expect(html).not.toContain(">updated<");
  });

  it("dates rows by when they were opened when sorted by newest (#1061)", async () => {
    const html = await renderList({ sort: "newest" });
    expect(html).toMatch(/<time dateTime="2026-10-01T10:00:00.000Z" title="Opened /);
  });
});

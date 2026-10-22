import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ bug: { findMany: vi.fn() }, project: { findFirst: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/tenant-context", () => ({ defaultProjectIdFor: vi.fn().mockResolvedValue("default-project") }));
import { feedProject, feedWhere, parseFeedCursor, readFeed } from "./feed";
import { AREA_NONE } from "@/lib/project-area-filter";

const timestamp = "2026-10-19T12:00:00.000Z";
describe("new-ticket feed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a complete, valid cursor", () => {
    expect(parseFeedCursor(new URLSearchParams())).toBeNull();
    for (const query of ["after=nope&afterId=a", `after=${timestamp}`, "afterId=a", "after=&afterId=a", "after=2026-02-30T00:00:00Z&afterId=a"]) {
      expect(() => parseFeedCursor(new URLSearchParams(query))).toThrow();
    }
    expect(parseFeedCursor(new URLSearchParams({ after: timestamp, afterId: "b" }))).toEqual({ after: timestamp, afterId: "b" });
  });

  it("uses the id to continue inside a shared timestamp, with tenant/project isolation", async () => {
    const cursor = { after: timestamp, afterId: "b" };
    const where = feedWhere("tenant-a", "project-a", cursor);
    expect(where).toEqual({
      tenantId: "tenant-a", projectId: "project-a", isDeleted: false,
      OR: [{ createdAt: { gt: new Date(timestamp) } }, { createdAt: new Date(timestamp), id: { gt: "b" } }],
    });
    db.bug.findMany.mockResolvedValue([{ id: "c", createdAt: new Date(timestamp) }]);
    const result = await readFeed("tenant-a", "project-a", cursor);
    expect(db.bug.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
    expect(result.nextCursor).toEqual({ after: timestamp, afterId: "c" });
  });

  it("pages a backlog without advancing the cursor beyond returned issues", async () => {
    db.bug.findMany.mockResolvedValue(Array.from({ length: 51 }, (_, i) => ({ id: String(i), createdAt: new Date(timestamp) })));
    const page = await readFeed("t", "p", null);
    expect(page.issues).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor?.afterId).toBe("49");
    db.bug.findMany.mockResolvedValue([]);
    expect((await readFeed("t", "p", page.nextCursor)).nextCursor).toEqual(page.nextCursor);
  });

  it("verifies an explicit project belongs to the tenant", async () => {
    db.project.findFirst.mockResolvedValue(null);
    expect(await feedProject("t", "foreign-project")).toBeNull();
    expect(db.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign-project", tenantId: "t" } }));
    await feedProject("t");
    expect(db.project.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "default-project", tenantId: "t" } }));
  });
});

  it("filters a project feed by area, including issues with no area", () => {
    expect(feedWhere("tenant-a", "project-a", null, "area-1")).toMatchObject({ areaId: "area-1" });
    expect(feedWhere("tenant-a", "project-a", null, AREA_NONE)).toMatchObject({ areaId: null });
  });

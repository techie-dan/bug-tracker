import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.hoisted(() => vi.fn());
const cookieSet = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet, set: cookieSet }),
}));

import {
  ACTIVE_PROJECT_COOKIE,
  activeProjectIdFor,
  pickProjectId,
  projectContextFor,
  setActiveProjectCookie,
} from "./project-context";

const projects = [
  { id: "p-oldest", name: "Web", slug: "web" },
  { id: "p-zedu", name: "Zedu", slug: "zedu" },
  { id: "p-desktop", name: "Desktop", slug: "desktop" },
];

function dbWith(rows: typeof projects) {
  return { project: { findMany: vi.fn().mockResolvedValue(rows) } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieGet.mockReturnValue(undefined);
});

describe("pickProjectId (#426)", () => {
  it("uses the requested project when it belongs to the tenant", () => {
    expect(pickProjectId(projects, "p-desktop")).toBe("p-desktop");
  });

  it("ignores a project from another tenant and falls back to Zedu", () => {
    expect(pickProjectId(projects, "p-other-tenant")).toBe("p-zedu");
  });

  it("uses Zedu by default, then the oldest project", () => {
    expect(pickProjectId(projects)).toBe("p-zedu");
    expect(pickProjectId([projects[0], projects[2]])).toBe("p-oldest");
  });

  it("has no project when the tenant has none", () => {
    expect(pickProjectId([])).toBeNull();
  });
});

describe("projectContextFor (#426)", () => {
  it("resolves the active project from the cookie", async () => {
    cookieGet.mockReturnValue({ value: "p-desktop" });
    const db = dbWith(projects);

    await expect(projectContextFor(db, "tenant-zedu")).resolves.toEqual({
      projects,
      activeProjectId: "p-desktop",
    });
  });

  it("falls back to Zedu when the cookie points at another tenant", async () => {
    cookieGet.mockReturnValue({ value: "p-other-tenant" });
    const db = dbWith(projects);

    await expect(activeProjectIdFor(db, "tenant-zedu")).resolves.toBe("p-zedu");
  });

  it("does not query without a tenant", async () => {
    const db = { project: { findMany: vi.fn() } } as never;
    await expect(projectContextFor(db, null)).resolves.toEqual({
      projects: [],
      activeProjectId: null,
    });
    expect((db as { project: { findMany: ReturnType<typeof vi.fn> } }).project.findMany)
      .not.toHaveBeenCalled();
  });

  it("leaves archived projects out of the switcher (#573)", async () => {
    const findMany = vi.fn().mockResolvedValue(projects);
    const db = { project: { findMany } } as never;
    await projectContextFor(db, "tenant-zedu");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-zedu", archivedAt: null },
      }),
    );
  });
});

describe("setActiveProjectCookie (#426)", () => {
  it("stores the choice for this device", async () => {
    await setActiveProjectCookie("p-desktop");
    expect(cookieSet).toHaveBeenCalledWith(
      ACTIVE_PROJECT_COOKIE,
      "p-desktop",
      expect.objectContaining({ path: "/", httpOnly: true, sameSite: "lax" }),
    );
  });
});

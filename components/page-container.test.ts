import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { PAGE_CONTAINER_CLASS } from "./page-container";

const read = (path: string) => readFileSync(path, "utf8");

describe("page container token (#415)", () => {
  it("defines one width and one padding", () => {
    expect(PAGE_CONTAINER_CLASS).toContain("mx-auto");
    expect(PAGE_CONTAINER_CLASS).toContain("w-full");
    expect(PAGE_CONTAINER_CLASS).toContain("max-w-6xl");
    expect(PAGE_CONTAINER_CLASS).toContain("px-4");
  });

  it("is the width the header and the layout main both use", () => {
    for (const source of [
      read("app/(app)/layout.tsx"),
      read("components/app-header.tsx"),
    ]) {
      expect(source).toContain("PAGE_CONTAINER_CLASS");
      expect(source).not.toContain("max-w-7xl");
    }
  });

  it("leaves no ad-hoc page wrapper on the routes named in the ticket", () => {
    // `settings/agents/connect` and `projects/[slug]/settings` from the
    // original ticket no longer exist on main (consolidated into `pair` and
    // the project list), so the guard covers the routes that still do.
    const routes = [
      "app/(app)/issues/(list)/page.tsx",
      "app/(app)/leaderboard/page.tsx",
      "app/(app)/settings/agents/page.tsx",
      "app/(app)/points/disputes/page.tsx",
    ];

    for (const route of routes) {
      expect(read(route), route).not.toMatch(/mx-auto max-w-\d+xl/);
    }
  });

  it("keeps the issue description at a readable measure inside the container", () => {
    expect(read("components/editable-issue-description.tsx")).toContain(
      "mt-2 max-w-3xl",
    );
  });
});

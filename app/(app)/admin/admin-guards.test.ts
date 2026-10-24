import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Middleware no longer checks roles for /admin (its JWT role goes stale, #121),
 * so each admin page must enforce the role itself from the database.
 */
const adminDir = path.resolve(__dirname);

function adminPages(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return adminPages(full);
    return entry === "page.tsx" ? [full] : [];
  });
}

describe("admin page guards (#121)", () => {
  const pages = adminPages(adminDir);

  it("finds the admin pages", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages.map((page) => [path.relative(adminDir, page), page]))(
    "%s checks the role server-side",
    (name, page) => {
      const source = readFileSync(page, "utf8");
      // Platforms, milestones and issue types belong to the open organization,
      // so the pages check that membership (and the site admin role) instead
      // of requireAdmin alone.
      if (name === path.join("categories", "page.tsx")) {
        expect(source).toMatch(/requireUser\(\)/);
        expect(source).toMatch(/platformScopeFor\(/);
        return;
      }
      if (name === path.join("milestones", "page.tsx")) {
        expect(source).toMatch(/requireUser\(\)/);
        expect(source).toMatch(/milestoneScopeFor\(/);
        return;
      }
      if (name === path.join("types", "page.tsx")) {
        expect(source).toMatch(/requireUser\(\)/);
        expect(source).toMatch(/issueTypeScopeFor\(/);
        return;
      }
      expect(source).toMatch(/require(Super)?Admin\(\)/);
    },
  );

  it("limits /admin/users to super admins", () => {
    const users = readFileSync(path.join(adminDir, "users", "page.tsx"), "utf8");
    expect(users).toMatch(/requireSuperAdmin\(\)/);
  });
});

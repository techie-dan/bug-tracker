import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

/**
 * Every route needs its own browser-tab title: they were all "Zedu Issues",
 * so tabs, history and bookmarks were indistinguishable.
 */
const pages: Array<[string, string]> = [
  ["app/(app)/issues/(list)/page.tsx", "Issues"],
  ["app/(app)/issues/new/page.tsx", "Report an issue"],
  ["app/(app)/settings/page.tsx", "Settings"],
  ["app/(app)/admin/types/page.tsx", "Issue types"],
  ["app/(app)/admin/categories/page.tsx", "Platforms"],
  ["app/(app)/admin/users/page.tsx", "Admins"],
  ["app/(auth)/login/page.tsx", "Sign in"],
  ["app/(auth)/forgot-password/page.tsx", "Forgot password"],
  ["app/(auth)/reset-password/page.tsx", "Set a new password"],
];

describe("page titles", () => {
  it.each(pages)("%s exports its own title", (path, title) => {
    expect(readFileSync(path, "utf8")).toContain(`export const metadata = { title: "${title}" }`);
  });

  it("uses distinct titles", () => {
    const titles = pages.map(([, t]) => t);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("keeps the root template that appends the site name", () => {
    expect(readFileSync("app/layout.tsx", "utf8")).toContain('template: "%s · Ziki"');
  });
});

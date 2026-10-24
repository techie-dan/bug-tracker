import { describe, expect, it } from "vitest";
import {
  nextProjectSlug,
  projectAreaSchema,
  PROJECT_SLUG_MAX,
  projectNameSchema,
  projectSettingsSchema,
  projectSlugBase,
} from "./validation";

describe("projectNameSchema (#426)", () => {
  it("trims and accepts a normal name", () => {
    expect(projectNameSchema.parse({ name: "  Zedu Web  " })).toEqual({
      name: "Zedu Web",
    });
  });

  it("rejects blank and overlong names", () => {
    expect(projectNameSchema.safeParse({ name: " " }).success).toBe(false);
    expect(projectNameSchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });
});

describe("projectSettingsSchema (#608)", () => {
  const valid = { name: "Web", goal: "Ship a fast app", repoUrl: "https://github.com/acme/web", stagingUrl: "https://staging.acme.test" };
  it("accepts valid project URLs and clears blank optional fields", () => {
    expect(projectSettingsSchema.parse({ ...valid, goal: "  ", repoUrl: "", stagingUrl: "" })).toMatchObject({ goal: null, repoUrl: null, stagingUrl: null });
    expect(projectSettingsSchema.parse(valid)).toMatchObject(valid);
  });
  it("rejects non-GitHub repositories, non-HTTPS staging URLs and oversized goals", () => {
    expect(projectSettingsSchema.safeParse({ ...valid, repoUrl: "https://example.com/acme/web" }).success).toBe(false);
    expect(projectSettingsSchema.safeParse({ ...valid, repoUrl: "https://github.com/acme" }).success).toBe(false);
    expect(projectSettingsSchema.safeParse({ ...valid, stagingUrl: "http://staging.acme.test" }).success).toBe(false);
    expect(projectSettingsSchema.safeParse({ ...valid, goal: "x".repeat(4001) }).success).toBe(false);
  });
});

describe("projectAreaSchema (#609)", () => {
  it("trims area fields and deduplicates path patterns", () => {
    expect(projectAreaSchema.parse({
      name: "  Frontend ",
      description: "  Owns the web UI  ",
      paths: " apps/web/**\n\n apps/web/** ",
    })).toEqual({
      name: "Frontend",
      description: "Owns the web UI",
      paths: ["apps/web/**"],
    });
  });

  it("clears blank optional fields", () => {
    expect(projectAreaSchema.parse({ name: "Backend", description: "  ", paths: "  " })).toEqual({
      name: "Backend",
      description: null,
      paths: [],
    });
  });

  it("rejects invalid names, parent paths, and too many patterns", () => {
    expect(projectAreaSchema.safeParse({ name: "x", description: "", paths: "" }).success).toBe(false);
    expect(projectAreaSchema.safeParse({ name: "Web", description: "", paths: "../secrets/**" }).success).toBe(false);
    expect(projectAreaSchema.safeParse({ name: "Web", description: "", paths: Array.from({ length: 26 }, (_, i) => `src/${i}/**`).join("\n") }).success).toBe(false);
  });
});

describe("projectSlugBase (#426)", () => {
  it("makes a URL-safe slug", () => {
    expect(projectSlugBase("Zedu Web")).toBe("zedu-web");
    expect(projectSlugBase("Café & Desktop")).toBe("cafe-desktop");
    expect(projectSlugBase("  ")).toBe("project");
  });

  it("caps the slug length", () => {
    expect(projectSlugBase("a".repeat(100))).toHaveLength(PROJECT_SLUG_MAX);
  });
});

describe("nextProjectSlug (#426)", () => {
  it("uses the base when it is free", () => {
    expect(nextProjectSlug("zedu-web", new Set())).toBe("zedu-web");
  });

  it("appends a counter for collisions", () => {
    expect(nextProjectSlug("zedu-web", new Set(["zedu-web"]))).toBe("zedu-web-2");
    expect(nextProjectSlug("zedu-web", new Set(["zedu-web", "zedu-web-2"]))).toBe(
      "zedu-web-3",
    );
  });

  it("keeps the suffix inside the slug limit", () => {
    const base = "a".repeat(PROJECT_SLUG_MAX);
    const slug = nextProjectSlug(base, new Set([base]));
    expect(slug.length).toBeLessThanOrEqual(PROJECT_SLUG_MAX);
    expect(slug.endsWith("-2")).toBe(true);
  });
});

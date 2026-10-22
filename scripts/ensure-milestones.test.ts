import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const columnSql = readFileSync("scripts/sql/ensure-milestones.sql", "utf8");
const enumSql = readFileSync("scripts/sql/ensure-milestone-activity-type.sql", "utf8");
const migrate = readFileSync("scripts/migrate.mjs", "utf8");

describe("Milestone and Bug.milestoneId startup repair", () => {
  it("creates the Milestone table, Bug.milestoneId column, index, and FK constraints without dropping anything", () => {
    expect(columnSql).toContain('CREATE TABLE IF NOT EXISTS "Milestone"');
    // The legacy global title index is only for databases that have not run
    // the #516 tenant migration yet.
    expect(columnSql).toMatch(/column_name\s*=\s*'tenantId'[\s\S]*Milestone_title_key/);
    expect(columnSql).not.toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS "Milestone_title_key"/m);
    expect(columnSql).toContain('ADD COLUMN IF NOT EXISTS "milestoneId"');
    expect(columnSql).toContain('CREATE INDEX IF NOT EXISTS "Bug_milestoneId_idx"');
    expect(columnSql).toContain('"Bug_milestoneId_fkey"');
    expect(columnSql.toLowerCase()).not.toMatch(/\bdrop\b/);
  });

  it("adds the activity enum in its own script", () => {
    expect(enumSql).toContain("ADD VALUE IF NOT EXISTS 'milestone_changed'");
    expect(enumSql.toLowerCase()).not.toMatch(/\bdrop\b/);
  });

  it("runs the repair and records the milestones migration", () => {
    expect(migrate).toContain("scripts/sql/ensure-milestones.sql");
    expect(migrate).toContain("scripts/sql/ensure-milestone-activity-type.sql");
    expect(migrate).toContain("20261019030000_milestones");
  });
});

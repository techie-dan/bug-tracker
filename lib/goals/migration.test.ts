import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * #616: goal budgets add the `Goal` entity and its pool allocations. The
 * migration must stay additive — the team ships it against databases that
 * already hold real accounts — so these checks lock the schema and migration
 * down.
 */

const migration = readFileSync(
  "prisma/migrations/20261027000000_add_goal_budgets/migration.sql",
  "utf8",
);
const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("goal budgets migration is additive-only (#616)", () => {
  it("creates the Goal and GoalAllocation tables", () => {
    expect(migration).toContain('CREATE TABLE "Goal"');
    expect(migration).toContain('CREATE TABLE "GoalAllocation"');
  });

  it("never drops a table, column, index, or constraint", () => {
    // Strip comments so the ticket's own "never a DROP" note does not match.
    const statements = migration
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE)\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("adds the enums, indexes, and foreign keys the schema declares", () => {
    expect(migration).toContain(`CREATE TYPE "GoalStatus"`);
    expect(migration).toContain(`CREATE TYPE "GoalSplitMethod"`);
    expect(migration).toContain(`CREATE TYPE "GoalAllocationTarget"`);
    expect(migration).toContain('CREATE UNIQUE INDEX "GoalAllocation_sourceKey_key"');
    expect(migration).toContain('"GoalAllocation_goalId_fkey"');
  });

  it("keeps allocations idempotent through a unique sourceKey", () => {
    expect(schema).toMatch(/model GoalAllocation \{[\s\S]*sourceKey\s+String\s+@unique/);
  });

  it("tracks the pool and what has been split off it", () => {
    expect(schema).toMatch(/model Goal \{[\s\S]*budgetPool\s+Int/);
    expect(schema).toMatch(/model Goal \{[\s\S]*allocated\s+Int\s+@default\(0\)/);
  });
});

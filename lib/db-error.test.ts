import { describe, expect, it } from "vitest";
import { databaseErrorReason } from "./db-error";

describe("databaseErrorReason", () => {
  it("names the missing column from a Prisma P2022 error", () => {
    const error = Object.assign(
      new Error(
        "Invalid `prisma.membership.findFirst()` invocation:\n\nThe column `Tenant.archivedAt` does not exist in the current database.",
      ),
      { code: "P2022", meta: { modelName: "Membership", column: "Tenant.archivedAt" } },
    );
    expect(databaseErrorReason(error)).toBe(
      "The database is missing the Tenant.archivedAt column, so this page could not finish loading.",
    );
  });

  it("names the missing table from a Prisma P2021 error", () => {
    const error = Object.assign(
      new Error("The table `public.ProjectWorkflow` does not exist in the current database."),
      { code: "P2021", meta: { table: "public.ProjectWorkflow" } },
    );
    expect(databaseErrorReason(error)).toBe(
      "The database is missing the public.ProjectWorkflow table, so this page could not finish loading.",
    );
  });

  it("explains a membership whose user row is gone", () => {
    expect(
      databaseErrorReason(new Error("Field user is required to return data, got `null` instead.")),
    ).toBe("A linked user record is missing, so this page could not finish loading.");
  });

  it("does not turn an unrelated failure into a schema message", () => {
    expect(databaseErrorReason(new Error("connection refused"))).toBeNull();
  });
});

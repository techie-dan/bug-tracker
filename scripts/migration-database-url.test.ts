import { describe, expect, it } from "vitest";
import { migrationDatabaseUrl } from "./migration-database-url.mjs";

const POOLED =
  "postgresql://user:secret-pooler@ep-example-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

describe("migrationDatabaseUrl", () => {
  it("rewrites a Neon pooler host and leaves the password alone", () => {
    const url = new URL(migrationDatabaseUrl(POOLED));
    expect(url.hostname).toBe("ep-example.c-7.us-east-2.aws.neon.tech");
    expect(url.password).toBe("secret-pooler");
    expect(url.username).toBe("user");
    expect(url.pathname).toBe("/neondb");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("channel_binding")).toBe("require");
  });

  it("leaves a direct or local url unchanged", () => {
    const local = "postgresql://bugtracker:bugtracker@localhost:5433/bugtracker";
    expect(migrationDatabaseUrl(local)).toBe(local);
  });

  it("prefers DIRECT_URL, including a quoted value", () => {
    const direct = "postgresql://u:p@direct.example:5432/neondb";
    expect(migrationDatabaseUrl(POOLED, `"${direct}"`)).toBe(direct);
  });
});

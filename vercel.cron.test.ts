import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Webhook deliveries and platform sweeps must actually get scheduled (#583, #647). */
describe("vercel.json cron (#583, #647)", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons?: { path: string; schedule: string }[];
  };

  it("schedules the webhook dispatcher at least once a minute", () => {
    const cron = config.crons?.find((entry) => entry.path === "/api/v1/webhooks/dispatch");
    expect(cron).toBeDefined();
    expect(cron!.schedule).toBe("* * * * *");
  });

  it("schedules the platform internal cron runner at least once a minute (#647)", () => {
    const cron = config.crons?.find((entry) => entry.path === "/api/internal/cron");
    expect(cron).toBeDefined();
    expect(cron!.schedule).toBe("* * * * *");
  });
});

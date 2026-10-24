/**
 * #679: how many authorised dispatch runs each caller (the external scheduler,
 * Vercel Cron) gets per minute. The default fits the documented cadence: a
 * run every 10 seconds plus a few extra batches. A runaway or compromised
 * scheduler can't hammer the delivery system or the database beyond it.
 * `WEBHOOK_DISPATCH_MAX_PER_MINUTE` raises or lowers it (1 to 120).
 */
export const DISPATCH_RUNS_PER_MINUTE = 12;
const MAX_DISPATCH_RUNS_PER_MINUTE = 120;

export function dispatchRunsPerMinute(raw = process.env.WEBHOOK_DISPATCH_MAX_PER_MINUTE): number {
  const value = Number(raw?.trim());
  if (!raw?.trim() || !Number.isInteger(value) || value < 1) return DISPATCH_RUNS_PER_MINUTE;
  return Math.min(value, MAX_DISPATCH_RUNS_PER_MINUTE);
}

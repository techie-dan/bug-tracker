export function getDefaultTimeZone(): string {
  return process.env.TZ || process.env.DEFAULT_TIMEZONE || "Africa/Lagos";
}

export const defaultTz =
  process.env.TZ || process.env.DEFAULT_TIMEZONE || "Africa/Lagos";

export function formatDate(value: Date | string, timeZone?: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timeZone || getDefaultTimeZone(),
  }).format(date);
}

export function formatRelativeTime(value: Date | string, now = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const elapsedMs = Math.max(0, now.getTime() - date.getTime());
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * A row's little date (#1061): "now", "5m", "3h", "2d" for the last week,
 * then "Oct 12", with the year once it isn't this year's. The full date goes
 * in a tooltip and for screen readers; this is only the glance.
 */
export function formatShortAge(value: Date | string, now = new Date(), timeZone?: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.floor(Math.max(0, now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const tz = timeZone || getDefaultTimeZone();
  const yearOf = (d: Date) => new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: tz }).format(d);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(yearOf(date) === yearOf(now) ? {} : { year: "numeric" }),
    timeZone: tz,
  }).format(date);
}


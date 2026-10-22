"use client";

import { useSyncExternalStore } from "react";
import { formatDate, formatShortAge } from "@/lib/format";
import { getClientTimeZone, getServerTimeZone } from "@/components/local-time";

const emptySubscribe = () => () => {};

/**
 * A short age ("3h", "2d", "Oct 12") for list rows (#1061). Hovering shows
 * the full date, and screen readers hear the full date with its label, never
 * "2d". The visible text depends on "now", so the client's render may differ
 * from the server's by a minute; that difference is expected.
 */
export function ShortTime({ date, label }: { date: Date | string; label: string }) {
  const isClient = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const timeZone = isClient ? getClientTimeZone() : getServerTimeZone();
  const full = formatDate(date, timeZone);
  const iso = date instanceof Date ? date.toISOString() : date;
  return (
    <time dateTime={iso} title={`${label} ${full}`} suppressHydrationWarning>
      <span aria-hidden="true" suppressHydrationWarning>
        {formatShortAge(date, new Date(), timeZone)}
      </span>
      <span className="sr-only">
        {label} {full}
      </span>
    </time>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { formatDate, getDefaultTimeZone } from "@/lib/format";

type LocalTimeProps = {
  date: Date | string;
  className?: string;
};

export function getClientTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || getDefaultTimeZone();
  } catch {
    return getDefaultTimeZone();
  }
}

export function getServerTimeZone(): string {
  return getDefaultTimeZone();
}

const emptySubscribe = () => () => {};

export function LocalTime({ date, className }: LocalTimeProps) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const timeZone = isClient ? getClientTimeZone() : getServerTimeZone();
  const formatted = formatDate(date, timeZone);
  const iso =
    date instanceof Date && !isNaN(date.getTime())
      ? date.toISOString()
      : typeof date === "string"
        ? date
        : "";

  return (
    <time dateTime={iso} className={className} title={`${formatted} (${timeZone})`}>
      {formatted}
    </time>
  );
}


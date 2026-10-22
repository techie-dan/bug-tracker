"use client";

import { useEffect, useState } from "react";
import { remainingLabel } from "@/lib/claim-deadline";

/**
 * The live countdown for an accepted claim (#593). The server renders one
 * label, then the browser refreshes it every 30 seconds; a slight hydration
 * mismatch is suppressed because the first client tick may differ by a minute.
 */
export function ClaimDeadline({ deliverBy }: { deliverBy: Date | string }) {
  const deadline = typeof deliverBy === "string" ? new Date(deliverBy) : deliverBy;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const label = remainingLabel(deadline, now);
  const text = label === "Overdue" ? "Delivery overdue" : `Delivery due in ${label?.replace(" left", "")}`;

  return (
    <span
      className={label === "Overdue" ? "font-medium text-red-700" : "font-medium text-slate-900"}
      suppressHydrationWarning
    >
      {text}
    </span>
  );
}

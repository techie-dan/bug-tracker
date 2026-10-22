"use client";

import { useState, useTransition } from "react";
import { markAllNotificationsReadAction } from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";

export function MarkAllReadButton({ allWorkspaces = false }: { allWorkspaces?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function markAllRead() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await markAllNotificationsReadAction(allWorkspaces);
        if (!result.ok) setError("Could not mark notifications as read. Please try again.");
      } catch {
        setError("Could not mark notifications as read. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="secondary" disabled={pending} onClick={markAllRead}>
        {pending ? "Marking…" : "Mark all as read"}
      </Button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

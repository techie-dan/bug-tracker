"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWatchingAction, unwatchFinishedAction } from "@/app/actions/watch";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

/** Stop watching one issue, from the "Issues I'm watching" list (#312). */
export function UnwatchButton({ bugId, label }: { bugId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      aria-label={`Unwatch ${label}`}
      className="min-h-11 px-3 text-xs text-slate-500 hover:text-slate-800 sm:min-h-0 sm:px-2.5 sm:py-1"
      onClick={() =>
        startTransition(async () => {
          const result = await setWatchingAction(bugId, false);
          if (result.error) {
            toast(result.error, "error");
            return;
          }
          toast(`You're no longer watching ${label}.`);
          // The row drops out of the list straight away.
          router.refresh();
        })
      }
    >
      {pending ? "Stopping…" : "Unwatch"}
    </Button>
  );
}

/** One-click "I'm done with the finished ones" for the same list (#312). */
export function UnwatchFinishedButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={pending}
      onClick={async () => {
        const ok = await confirm({
          title: `Stop watching ${count} resolved or closed ${count === 1 ? "issue" : "issues"}?`,
          body:
            "You won't get emails or notifications about them any more. You can watch any of them again from its page.",
          confirmLabel: "Stop watching",
        });
        if (!ok) return;
        startTransition(async () => {
          const result = await unwatchFinishedAction();
          if (result.error) {
            toast(result.error, "error");
            return;
          }
          toast(
            `Stopped watching ${result.count ?? 0} ${result.count === 1 ? "issue" : "issues"}.`,
          );
          router.refresh();
        });
      }}
    >
      {pending ? "Working…" : `Stop watching ${count} resolved or closed`}
    </Button>
  );
}

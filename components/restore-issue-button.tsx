"use client";

import { useState, useTransition } from "react";
import { restoreBugAction } from "@/app/actions/issues";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  restoreSummary,
  type TicketDeletionCounts,
} from "@/lib/ticket-deletion";

type RestoreBugButtonProps = {
  bugId: string;
  bugTitle: string;
  /** Shown in the confirm text so it matches the page. */
  counts?: TicketDeletionCounts;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  label?: string;
  className?: string;
};

function AlertIcon({ className = "h-3.5 w-3.5 shrink-0" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function RestoreIssueButton({
  bugId,
  bugTitle,
  counts,
  variant = "primary",
  size = "md",
  label = "Restore issue",
  className = "",
}: RestoreBugButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const errorId = `restore-error-${bugId}`;
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const toast = useToast();

  const sizeClasses =
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        aria-describedby={error ? errorId : undefined}
        className={`${sizeClasses} ${className}`}
        onClick={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const confirmed = await confirm({
            title: `Restore "${bugTitle}"?`,
            body: restoreSummary(counts),
            confirmLabel: "Restore issue",
          });
          if (!confirmed) return;

          setError(null);
          startTransition(async () => {
            try {
              const result = await restoreBugAction(bugId);
              if (result?.error) {
                setError(result.error);
                toast(result.error, "error");
              } else {
                toast("Issue restored.");
              }
            } catch {
              setError("Could not restore issue. Please try again.");
              toast("Could not restore issue. Please try again.", "error");
            }
          });
        }}
      >
        <span className="flex items-center gap-1.5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"}
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.451a.75.75 0 0 0 0-1.5H4.5a.75.75 0 0 0-.75.75v3.75a.75.75 0 0 0 1.5 0v-2.19l.418.418a7 7 0 1 0 1.39-8.497.75.75 0 0 0-1.06 1.06 5.5 5.5 0 0 1 9.314 4.124Z"
              clipRule="evenodd"
            />
          </svg>
          <span>{pending ? "Restoring…" : label}</span>
        </span>
      </Button>
      {error ? (
        <span
          id={errorId}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700"
          role="alert"
        >
          <AlertIcon className="h-3.5 w-3.5 shrink-0 text-red-600" />
          <span>{error}</span>
        </span>
      ) : null}
    </div>
  );
}

export { RestoreIssueButton as RestoreBugButton };

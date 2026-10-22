"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { deleteBugAction } from "@/app/actions/issues";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  deleteSummary,
  type TicketDeletionCounts,
} from "@/lib/ticket-deletion";
import { isRedirectError } from "@/lib/toast-store";

type DeleteBugButtonProps = {
  bugId: string;
  bugTitle: string;
  /** Shown in the confirm text so it matches the page. */
  counts?: TicketDeletionCounts;
  variant?: "danger" | "danger-secondary" | "ghost";
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

export function DeleteIssueButton({
  bugId,
  bugTitle,
  counts,
  variant = "danger-secondary",
  size = "md",
  label = "Delete issue",
  className = "",
}: DeleteBugButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const errorId = `delete-error-${bugId}`;
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
            title: `Delete "${bugTitle}"?`,
            body: deleteSummary(counts),
            confirmLabel: "Delete issue",
            tone: "danger",
          });
          if (!confirmed) return;

          setError(null);
          startTransition(async () => {
            try {
              const result = await deleteBugAction(bugId);
              if (result?.error) {
                setError(result.error);
                toast(result.error, "error");
              } else {
                toast("Issue deleted.");
              }
            } catch (err) {
              // From the issue page the action ends in redirect("/bugs"),
              // which throws. The provider lives in the root layout and
              // survives that client-side navigation, so the toast has to be
              // raised here, before unstable_rethrow() stops this function.
              if (isRedirectError(err)) toast("Issue deleted.");
              unstable_rethrow(err);
              setError("Could not delete issue. Please try again.");
              toast("Could not delete issue. Please try again.", "error");
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
              d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
              clipRule="evenodd"
            />
          </svg>
          <span>{pending ? "Deleting…" : label}</span>
        </span>
      </Button>
      {error ? (
        <p
          id={errorId}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700"
          role="alert"
        >
          <AlertIcon className="h-3.5 w-3.5 shrink-0 text-red-600" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export { DeleteIssueButton as DeleteBugButton };

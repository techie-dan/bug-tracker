"use client";

import { useState, useTransition } from "react";
import { selfAssignBugAction } from "@/app/actions/issues";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type SelfAssignButtonProps = {
  bugId: string;
  isAssignedToMe: boolean;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "default";
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

export function SelfAssignButton({
  bugId,
  isAssignedToMe,
  variant = "secondary",
  size = "sm",
  className = "",
}: SelfAssignButtonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const errorId = `assign-error-${bugId}`;
  const toast = useToast();

  const handleToggle = (assign: boolean) => {
    setError(null);
    startTransition(async () => {
      const result = await selfAssignBugAction(bugId, assign);
      if (result.error) {
        setError(result.error);
        toast(result.error, "error");
      } else {
        // The row re-renders in place, so without this there is nothing to
        // tell a screen reader — or a distracted eye — that anything happened.
        toast(assign ? "Assigned to you." : "Unassigned.");
      }
    });
  };

  if (variant === "ghost" || size === "xs") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => handleToggle(!isAssignedToMe)}
          className={`rounded text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 disabled:opacity-50 ${
            isAssignedToMe
              ? "text-slate-500 hover:text-red-600 hover:underline"
              : "text-teal-700 hover:text-teal-800 hover:underline"
          } ${className}`}
          title={isAssignedToMe ? "Unassign yourself from this issue" : "Assign this issue to yourself"}
        >
          {pending
            ? isAssignedToMe
              ? "Unassigning…"
              : "Assigning…"
            : isAssignedToMe
              ? "Unassign"
              : "Assign to me"}
        </button>
        {error ? (
          <span className="text-xs text-red-600" role="alert">
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={isAssignedToMe ? "secondary" : variant}
        disabled={pending}
        onClick={() => handleToggle(!isAssignedToMe)}
        aria-describedby={error ? errorId : undefined}
        className={`${size === "sm" ? "px-3 py-1.5 text-xs" : ""} ${className}`}
        title={
          isAssignedToMe
            ? "Unassign yourself from this issue"
            : "Assign this issue to yourself"
        }
      >
        {pending ? (
          isAssignedToMe ? "Unassigning…" : "Assigning…"
        ) : isAssignedToMe ? (
          <>
            <span aria-hidden="true">✓</span> Assigned to you · Unassign
          </>
        ) : (
          <>
            <span aria-hidden="true">👤</span> Assign to me
          </>
        )}
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

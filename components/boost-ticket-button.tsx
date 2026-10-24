"use client";

import { useState, useTransition } from "react";
import { toggleBoostBugAction } from "@/app/actions/issues";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type BoostTicketButtonProps = {
  bugId: string;
  isBoosted: boolean;
  variant?: "secondary" | "ghost";
  size?: "sm" | "md";
  showLabel?: boolean;
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

export function BoostTicketButton({
  bugId,
  isBoosted: initialBoosted,
  variant = "secondary",
  size = "sm",
  showLabel = true,
  className = "",
}: BoostTicketButtonProps) {
  const [boosted, setBoosted] = useState(initialBoosted);
  // Follow the server when the boost changes elsewhere, e.g. closing the
  // issue removes it (#256); adjusted during render rather than in an effect.
  const [lastInitial, setLastInitial] = useState(initialBoosted);
  if (initialBoosted !== lastInitial) {
    setLastInitial(initialBoosted);
    setBoosted(initialBoosted);
  }
  const [error, setError] = useState<string | null>(null);
  const errorId = `boost-error-${bugId}`;
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const sizeClasses =
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        title={boosted ? "Remove boost from issue" : "Boost issue to top of list"}
        aria-pressed={boosted}
        aria-describedby={error ? errorId : undefined}
        className={`${sizeClasses} ${
          boosted
            ? "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 focus-visible:ring-amber-500"
            : "text-slate-700 hover:border-amber-300 hover:bg-amber-50/50 hover:text-amber-800"
        } ${className}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setError(null);

          const previous = boosted;
          const next = !boosted;
          setBoosted(next);

          startTransition(async () => {
            try {
              const result = await toggleBoostBugAction(bugId);
              if (result.error) {
                setBoosted(previous);
                setError(result.error);
                toast(result.error, "error");
              } else {
                const now = result.isBoosted ?? next;
                setBoosted(now);
                toast(now ? "Issue boosted." : "Boost removed.");
              }
            } catch {
              setBoosted(previous);
              setError("Failed to update boost status. Please try again.");
              toast("Failed to update boost status. Please try again.", "error");
            }
          });
        }}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={
              size === "sm"
                ? "h-3.5 w-3.5 text-amber-600"
                : "h-4 w-4 text-amber-600"
            }
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M11.3 1.046A1 1 0 0 1 12 2v5h4a1 1 0 0 1 .82 1.573l-7 10A1 1 0 0 1 8 18v-5H4a1 1 0 0 1-.82-1.573l7-10a1 1 0 0 1 1.12-.38Z"
              clipRule="evenodd"
            />
          </svg>
          {/*
            The icon-only variant used to rely on `title` for its name, which
            touch devices and several screen readers never expose (#315). The
            text is always rendered; it is only hidden visually.
          */}
          <span className={showLabel ? undefined : "sr-only"}>
            {pending
              ? boosted
                ? "Unboosting…"
                : "Boosting…"
              : boosted
                ? "Boosted"
                : "Boost to top"}
          </span>
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

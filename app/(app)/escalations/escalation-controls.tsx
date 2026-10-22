"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  answerEscalationAction,
  quickResolveEscalationAction,
  type AnswerActionResult,
} from "./actions";
import type { EscalationType } from "@/lib/agent-questions";

export function EscalationTypeBadge({ type }: { type: EscalationType | string }) {
  const styles: Record<string, string> = {
    Blocker: "bg-rose-50 text-rose-800 border-rose-200",
    "Work Authorization": "bg-amber-50 text-amber-800 border-amber-200",
    "Human Approval": "bg-purple-50 text-purple-800 border-purple-200",
    "Scope Expansion": "bg-sky-50 text-sky-800 border-sky-200",
    Question: "bg-slate-100 text-slate-800 border-slate-200",
  };

  const icons: Record<string, string> = {
    Blocker: "🛑",
    "Work Authorization": "🛡️",
    "Human Approval": "👤",
    "Scope Expansion": "⚠️",
    Question: "❓",
  };

  const badgeStyle = styles[type] ?? styles.Question;
  const icon = icons[type] ?? "❓";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${badgeStyle}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{type}</span>
    </span>
  );
}

export function QuickResolveButtons({
  escalationId,
  onResolved,
}: {
  escalationId: string;
  onResolved?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleResolve = (actionType: "approve" | "authorize") => {
    startTransition(async () => {
      const res = await quickResolveEscalationAction(escalationId, actionType);
      if (res.ok) {
        onResolved?.();
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        disabled={isPending}
        onClick={() => handleResolve("approve")}
        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-1.5"
      >
        {isPending ? "Unblocking…" : "✓ Approve & Unblock"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={isPending}
        onClick={() => handleResolve("authorize")}
        className="text-xs px-2.5 py-1.5"
      >
        Authorize Work
      </Button>
    </div>
  );
}

export function EscalationAnswerForm({
  escalationId,
  labelledBy,
}: {
  escalationId: string;
  labelledBy?: string;
}) {
  const [result, action, pending] = useActionState<AnswerActionResult | undefined, FormData>(
    answerEscalationAction,
    undefined,
  );
  const error = result && !result.ok ? result.error : null;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="escalationId" value={escalationId} />
      <div className="space-y-1">
        {!labelledBy ? (
          <label htmlFor="answer" className="block text-sm font-medium text-slate-800">
            Your response
          </label>
        ) : null}
        <Textarea
          id="answer"
          name="answer"
          rows={4}
          required
          maxLength={2000}
          placeholder="Provide decision, unblocking guidance, or instructions..."
          aria-labelledby={labelledBy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "answer-error" : undefined}
        />
      </div>
      {error ? (
        <p id="answer-error" role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send response"}
        </Button>
        <span className="text-xs text-slate-500">
          The response cannot be edited once dispatched to the agent.
        </span>
      </div>
    </form>
  );
}

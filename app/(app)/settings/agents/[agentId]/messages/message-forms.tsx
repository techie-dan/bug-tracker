"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  sendAgentMessageAction,
  setAgentInstructionsAction,
  type AgentMessageActionResult,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Write to the agent (#605). It arrives in the agent's inbox as a `message`. */
export function SendMessageForm({ agentId, maxLength }: { agentId: string; maxLength: number }) {
  const [result, action, pending] = useActionState<AgentMessageActionResult | undefined, FormData>(
    sendAgentMessageAction,
    undefined,
  );
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (result?.ok) form.current?.reset();
  }, [result]);
  const error = result && !result.ok ? result.error : null;

  return (
    <form ref={form} action={action} className="space-y-3">
      <input type="hidden" name="agentId" value={agentId} />
      <label htmlFor="message-body" className="block text-sm font-medium text-slate-800">
        Message
      </label>
      <Textarea
        id="message-body"
        name="body"
        rows={3}
        required
        maxLength={maxLength}
        placeholder="Focus on desktop bugs today."
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "message-error" : undefined}
      />
      {error ? (
        <p id="message-error" role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}

/** The owner's standing brief, returned to the agent by `GET /api/v1/agents/me`. */
export function InstructionsForm({
  agentId,
  instructions,
  maxLength,
}: {
  agentId: string;
  instructions: string | null;
  maxLength: number;
}) {
  const [result, action, pending] = useActionState<AgentMessageActionResult | undefined, FormData>(
    setAgentInstructionsAction,
    undefined,
  );
  const error = result && !result.ok ? result.error : null;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="agentId" value={agentId} />
      <label htmlFor="agent-instructions" className="block text-sm font-medium text-slate-800">
        Standing instructions
      </label>
      <Textarea
        id="agent-instructions"
        name="instructions"
        rows={5}
        maxLength={maxLength}
        defaultValue={instructions ?? ""}
        placeholder="Use the staging URL. Leave #212 alone."
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "instructions-error" : "instructions-help"}
      />
      <p id="instructions-help" className="text-xs text-slate-500">
        Up to {maxLength} characters. Leave blank to clear.
      </p>
      {error ? (
        <p id="instructions-error" role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {result?.ok ? (
        <p role="status" className="text-sm text-emerald-700">
          Saved.
        </p>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save instructions"}
      </Button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { requestTenantJoinAction, type JoinTenantActionResult } from "./actions";

export function JoinWorkspaceForm({ tenantId, pending }: { tenantId: string; pending: boolean }) {
  const [state, action, isPending] = useActionState<JoinTenantActionResult | undefined, FormData>(
    requestTenantJoinAction,
    undefined,
  );
  const requested = state?.pending || pending;

  return (
    <div className="shrink-0">
      <form action={action}>
        <input type="hidden" name="tenantId" value={tenantId} />
        <Button type="submit" variant={requested ? "secondary" : "primary"} disabled={requested || isPending}>
          {isPending ? "Sending…" : requested ? "Request Pending" : "Join"}
        </Button>
      </form>
      {state?.error ? <p role="alert" className="mt-2 max-w-56 text-xs text-red-700">{state.error}</p> : null}
      {requested ? <p className="sr-only" role="status">Your request is pending review.</p> : null}
    </div>
  );
}

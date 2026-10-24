"use client";

import { useActionState } from "react";
import { awardIssueBidAction, type AwardBidResult } from "@/app/actions/issue-bids";
import { Button } from "@/components/ui/button";

export type OpenBid = {
  id: string;
  agentName: string;
  personName: string;
  note: string | null;
  areaMatch?: boolean;
};

/** Open bids on one issue. Awarding one assigns the task. */
export function IssueBids({ bids, canAward }: { bids: OpenBid[]; canAward: boolean }) {
  const [result, action, pending] = useActionState<AwardBidResult | undefined, FormData>(awardIssueBidAction, undefined);
  if (bids.length === 0) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="bids-heading">
      <h2 id="bids-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Bids
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Agents asked for this task. A bid does not assign it. Award one to give the agent the work.
      </p>
      <ul className="mt-3 divide-y divide-slate-100">
        {bids.map((bid) => (
          <li key={bid.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium text-slate-900">
                {bid.agentName}
                <span className="font-normal text-slate-500"> for {bid.personName}</span>
                {bid.areaMatch ? <span className="ml-2 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-900">Area match</span> : null}
              </p>
              {bid.note ? <p className="mt-0.5 text-sm text-slate-600">{bid.note}</p> : null}
            </div>
            {canAward ? (
              <form action={action}>
                <input type="hidden" name="bidId" value={bid.id} />
                <Button type="submit" disabled={pending}>
                  {pending ? "Awarding…" : "Award"}
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {result && !result.ok ? (
        <p className="mt-2 text-sm text-red-700" role="alert">{result.error}</p>
      ) : null}
    </section>
  );
}

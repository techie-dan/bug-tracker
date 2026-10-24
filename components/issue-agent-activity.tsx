import type { Severity } from "@prisma/client";
import { severityLabel } from "@/lib/labels";
import { LocalTime } from "@/components/local-time";
import { ClaimDeadline } from "@/components/claim-deadline";
import { ExpandableText } from "@/components/expandable-text";

/**
 * What agents decided on one issue, in sentences (#448). The raw audit dump
 * stays on the audit page (#447); nothing here renders a JSON payload.
 */
export type AgentDecision =
  | {
      id: string;
      at: Date | string;
      kind: "confirmed";
      agentName: string;
      /** The person the agent acted for. */
      personName: string;
      severity: Severity | null;
    }
  | {
      id: string;
      at: Date | string;
      /** #1122: a reviewer found it isn't a real issue. Never a confirmation. */
      kind: "rejected";
      agentName: string;
      personName: string;
      /** The reviewer's reasons, usually the reproduction they tried. */
      notes: string | null;
    }
  | {
      id: string;
      at: Date | string;
      kind: "claimed";
      agentName: string;
      personName: string;
      /** #593: the delivery deadline, and whether the one extension was used. */
      deliverBy?: Date | string | null;
      extendedAt?: Date | string | null;
      /** #606: the agent's owner, while the claim is paused on their answer. */
      waitingOnName?: string | null;
    }
  | { id: string; at: Date | string; kind: "verdict"; agentName: string; personName: string; goodToMerge: boolean }
  | { id: string; at: Date | string; kind: "accepted"; agentName: string };

function timeOf(decision: AgentDecision): number {
  return new Date(decision.at).getTime();
}

function sentence(decision: AgentDecision) {
  switch (decision.kind) {
    case "confirmed":
      return (
        <>
          <span className="font-medium text-slate-900">{decision.agentName}</span> confirmed this issue as real
          {decision.severity ? (
            <>
              {" "}
              and set the severity to{" "}
              <span className="font-medium text-slate-900">{severityLabel[decision.severity]}</span>
            </>
          ) : null}
          {decision.personName ? <> on behalf of {decision.personName}</> : null}.
        </>
      );
    case "rejected":
      return (
        <>
          <span className="font-medium text-slate-900">{decision.agentName}</span> found this isn&apos;t a real
          issue{decision.personName ? <> on behalf of {decision.personName}</> : null}.
        </>
      );
    case "claimed":
      return (
        <>
          <span className="font-medium text-slate-900">{decision.agentName}</span> claimed this issue for{" "}
          {decision.personName}.
          {decision.waitingOnName ? (
            <>
              {" "}
              Waiting for {decision.waitingOnName} to answer {decision.agentName}&apos;s question.
            </>
          ) : decision.deliverBy ? (
            <>
              {" "}
              <ClaimDeadline deliverBy={decision.deliverBy} />
              {decision.extendedAt ? " (extension used)" : ""}.
            </>
          ) : null}
        </>
      );
    case "verdict":
      return (
        <>
          <span className="font-medium text-slate-900">{decision.agentName}</span> said this fix is{" "}
          {decision.goodToMerge ? "good to merge" : "not ready to merge"}.
        </>
      );
    case "accepted":
      return (
        <>
          <span className="font-medium text-slate-900">{decision.agentName}</span> accepted the fix and marked this
          issue resolved.
        </>
      );
  }
}

/**
 * The agent decisions on an issue, oldest first. Renders nothing when there
 * are none, so an issue with no agent activity omits the section.
 */
export function IssueAgentActivity({ decisions }: { decisions: ReadonlyArray<AgentDecision> }) {
  if (decisions.length === 0) return null;

  const ordered = [...decisions].sort((a, b) => timeOf(a) - timeOf(b) || a.id.localeCompare(b.id));

  return (
    <section
      aria-label="Agent decisions"
      className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Agent decisions
      </h2>
      <ol className="relative mt-5 space-y-0 border-l border-slate-200 pl-4 sm:pl-5">
        {ordered.map((decision) => (
          <li key={decision.id} className="relative pb-5 last:pb-0">
            <span
              aria-hidden
              className="absolute -left-[1.2rem] sm:-left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-teal-600"
            />
            <LocalTime className="text-xs text-slate-500" date={decision.at} />
            <p className="mt-1 text-sm text-slate-800">{sentence(decision)}</p>
            {decision.kind === "rejected" && decision.notes ? (
              <ExpandableText maxLines={3} expandText="View more" collapseText="View less">
                <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-slate-300 pl-3 text-sm text-slate-700">
                  {decision.notes}
                </blockquote>
              </ExpandableText>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

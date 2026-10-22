import Link from "next/link";
import { parseEscalationBody } from "@/lib/agent-questions";
import { LocalTime } from "@/components/local-time";
import { EscalationTypeBadge, QuickResolveButtons } from "@/app/(app)/escalations/escalation-controls";

export type TicketEscalation = {
  id: string;
  body: string;
  answer?: string | null;
  answeredAt?: Date | null;
  createdAt: Date;
  agent: {
    id?: string;
    name: string;
  };
};

export function IssueEscalations({
  escalations,
}: {
  escalations: TicketEscalation[];
}) {
  if (escalations.length === 0) {
    return null;
  }

  const pending = escalations.filter((e) => !e.answeredAt);

  return (
    <section
      id="escalations"
      aria-label="Agent escalations"
      className="scroll-mt-24 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Escalations ({escalations.length})
          </h2>
          {pending.length > 0 ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              {pending.length} unresolved
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
              All resolved
            </span>
          )}
        </div>
        <Link
          href="/escalations"
          className="text-xs font-medium text-teal-700 hover:underline"
        >
          View all workspace escalations →
        </Link>
      </div>

      <ul className="space-y-3">
        {escalations.map((esc) => {
          const parsed = parseEscalationBody(esc.body);
          const type = parsed.type;
          const isPending = !esc.answeredAt;

          return (
            <li
              key={esc.id}
              className={`rounded-lg border p-4 space-y-3 transition-colors ${
                isPending
                  ? "border-amber-200 bg-amber-50/20"
                  : "border-slate-200 bg-slate-50/40"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <EscalationTypeBadge type={type} />
                  <span className="text-sm font-semibold text-slate-900">
                    {esc.agent.name}
                  </span>
                  <span className="text-xs text-slate-400">•</span>
                  <LocalTime date={esc.createdAt} className="text-xs text-slate-500" />
                </div>
                {isPending ? (
                  <span className="text-xs font-medium text-amber-700">Awaiting guidance</span>
                ) : (
                  <span className="text-xs font-medium text-emerald-700">✓ Resolved</span>
                )}
              </div>

              <p className="whitespace-pre-wrap text-sm text-slate-800">{parsed.cleanBody}</p>

              {isPending ? (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-amber-200/60">
                  <QuickResolveButtons escalationId={esc.id} />
                  <Link
                    href={`/escalations/${esc.id}`}
                    className="text-xs font-medium text-teal-700 hover:underline"
                  >
                    Custom response →
                  </Link>
                </div>
              ) : (
                <div className="rounded bg-white p-3 text-xs text-slate-700 border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-600">Resolution:</span>
                  <p className="whitespace-pre-wrap">{esc.answer}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

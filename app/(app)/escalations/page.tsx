import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { listOwnerQuestions, parseEscalationBody, type EscalationType } from "@/lib/agent-questions";
import { LocalTime } from "@/components/local-time";
import { EscalationTypeBadge, QuickResolveButtons } from "./escalation-controls";

export const metadata = { title: "Agent Escalations" };

const ALL_TYPES: EscalationType[] = [
  "Blocker",
  "Work Authorization",
  "Question",
  "Scope Expansion",
  "Human Approval",
];

export default async function EscalationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; type?: string }>;
}) {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  const questions = tenantId ? await listOwnerQuestions(user.id, tenantId) : [];

  const params = searchParams ? await searchParams : {};
  const statusFilter = params.status ?? "waiting";
  const typeFilter = params.type ?? "all";

  const enriched = questions.map((q) => {
    const parsed = parseEscalationBody(q.body);
    return {
      ...q,
      body: parsed.cleanBody,
      escalationType: parsed.type,
      isWaiting: !q.answeredAt,
    };
  });

  const pendingCount = enriched.filter((q) => q.isWaiting).length;

  const filtered = enriched.filter((item) => {
    if (statusFilter === "waiting" && !item.isWaiting) return false;
    if (statusFilter === "answered" && item.isWaiting) return false;
    if (typeFilter !== "all" && item.escalationType !== typeFilter) return false;
    return true;
  });

  const makeQuery = (newStatus: string, newType: string) => {
    const q = new URLSearchParams();
    if (newStatus !== "waiting") q.set("status", newStatus);
    if (newType !== "all") q.set("type", newType);
    const s = q.toString();
    return s ? `/escalations?${s}` : "/escalations";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Agent Escalations</h1>
          <p className="text-sm text-slate-600">
            Incoming blockers, authorization requests, and questions requiring human guidance.
          </p>
        </div>
        {pendingCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 border border-amber-200">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            {pendingCount} waiting for resolution
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 border border-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            All escalations unblocked
          </span>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Status</span>
          <div className="flex items-center gap-1">
            <Link
              href={makeQuery("waiting", typeFilter)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === "waiting"
                  ? "bg-teal-700 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Waiting ({pendingCount})
            </Link>
            <Link
              href={makeQuery("answered", typeFilter)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === "answered"
                  ? "bg-teal-700 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Resolved ({enriched.length - pendingCount})
            </Link>
            <Link
              href={makeQuery("all", typeFilter)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === "all"
                  ? "bg-teal-700 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              All ({enriched.length})
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Type</span>
          <Link
            href={makeQuery(statusFilter, "all")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              typeFilter === "all"
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All Types
          </Link>
          {ALL_TYPES.map((t) => (
            <Link
              key={t}
              href={makeQuery(statusFilter, t)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                typeFilter === t
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t}
            </Link>
          ))}
        </div>
      </div>

      {filtered.length > 0 ? (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-xs">
          {filtered.map((item) => (
            <li key={item.id} className="p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <EscalationTypeBadge type={item.escalationType} />
                  <Link
                    href={`/escalations/${item.id}`}
                    className="font-medium text-teal-800 hover:underline"
                  >
                    {item.agent.name}
                  </Link>
                  <span className="text-xs text-slate-400">•</span>
                  <LocalTime date={item.createdAt} className="text-xs text-slate-500" />
                </div>
                {item.isWaiting ? (
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
                    Awaiting response
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                    Resolved
                  </span>
                )}
              </div>

              <p className="text-sm text-slate-800 whitespace-pre-wrap">{item.body}</p>

              {item.bug ? (
                <div className="text-xs">
                  <span className="text-slate-500">Linked Issue: </span>
                  <Link
                    href={`/issues/${item.bug.id}`}
                    className="font-medium text-teal-700 hover:underline"
                  >
                    #{item.bug.title}
                  </Link>
                </div>
              ) : null}

              {item.isWaiting ? (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                  <QuickResolveButtons escalationId={item.id} />
                  <Link
                    href={`/escalations/${item.id}`}
                    className="text-xs font-medium text-teal-700 hover:underline"
                  >
                    Write custom response →
                  </Link>
                </div>
              ) : (
                <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-700 border border-slate-100 space-y-1">
                  <span className="font-semibold text-slate-600">Your resolution:</span>
                  <p className="whitespace-pre-wrap">{item.answer}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center bg-white">
          <p className="text-sm font-medium text-slate-700">No escalations match this filter.</p>
          <p className="mt-1 text-xs text-slate-500">
            Agents ask for blockers, permissions, and guidance here.
          </p>
        </div>
      )}
    </div>
  );
}

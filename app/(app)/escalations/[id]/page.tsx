import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { ownerQuestion, parseEscalationBody } from "@/lib/agent-questions";
import { LocalTime } from "@/components/local-time";
import {
  EscalationTypeBadge,
  QuickResolveButtons,
  EscalationAnswerForm,
} from "../escalation-controls";

export const metadata = { title: "Resolve Agent Escalation" };

export default async function EscalationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) notFound();
  const { id } = await params;
  const question = await ownerQuestion(user.id, tenantId, id);
  if (!question) notFound();

  const parsed = parseEscalationBody(question.body);
  const escalationType = parsed.type;

  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <Link href="/escalations" className="inline-flex items-center text-sm text-teal-700 hover:underline">
        ← Back to Escalations
      </Link>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <EscalationTypeBadge type={escalationType} />
            <h1 className="text-xl font-semibold text-slate-900">{question.agent.name}</h1>
          </div>
          <LocalTime date={question.createdAt} className="text-xs text-slate-500" />
        </div>

        <div className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Escalation Details
          </h2>
          <p className="whitespace-pre-wrap text-sm text-slate-800 leading-relaxed bg-slate-50/60 p-4 rounded-lg border border-slate-100">
            {parsed.cleanBody}
          </p>
        </div>

        {question.bug ? (
          <div className="rounded-lg bg-teal-50/50 p-3 border border-teal-100 text-xs">
            <span className="text-slate-600">Associated issue: </span>
            <Link
              href={`/issues/${question.bug.id}`}
              className="font-medium text-teal-800 hover:underline"
            >
              #{question.bug.title}
            </Link>
          </div>
        ) : null}

        <div className="pt-2">
          <h2 id="response-heading" className="text-sm font-semibold text-slate-900 mb-3">
            {question.answeredAt ? "Resolution Provided" : "Respond to Agent"}
          </h2>

          {question.answeredAt ? (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="flex items-center justify-between text-xs text-emerald-900 font-medium">
                <span>✓ Resolved</span>
                <LocalTime date={question.answeredAt} className="text-slate-500" />
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-800">{question.answer}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
                <span className="block text-xs font-medium text-slate-600 mb-2">
                  Quick Actions:
                </span>
                <QuickResolveButtons escalationId={question.id} />
              </div>
              <EscalationAnswerForm escalationId={question.id} labelledBy="response-heading" />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

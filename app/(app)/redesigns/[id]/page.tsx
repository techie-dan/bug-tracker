import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { LocalTime } from "@/components/local-time";
import { DecisionButtons } from "../decision-buttons";

export const metadata = { title: "Review redesign" };
export default async function RedesignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) notFound();
  const { id } = await params;
  const proposal = await prisma.redesignProposal.findFirst({ where: { id, tenantId },
    include: { authorAgent: { select: { name: true } }, onBehalfOf: { select: { name: true } }, approver: { select: { name: true } } },
  });
  if (!proposal) notFound();
  return <article className="space-y-5">
    <Link href="/redesigns" className="text-indigo-700 underline">All redesign proposals</Link>
    <h1 className="text-2xl font-semibold">{proposal.title}</h1>
    <p className="text-sm text-slate-600">Proposed by {proposal.authorAgent.name} for {proposal.onBehalfOf.name}.</p>
    <p className="font-medium">{proposal.status === "proposed" ? "waiting for a person" : proposal.status}</p>
    <div className="whitespace-pre-wrap rounded border border-slate-200 bg-white p-5">{proposal.body}</div>
    {proposal.bugId && <Link href={`/issues/${proposal.bugId}`} className="block text-indigo-700 underline">View linked issue</Link>}
    {proposal.status === "proposed" && !proposal.bugId && <DecisionButtons id={proposal.id} />}
    {proposal.approvedAt && <p className="text-sm text-slate-600">Approved by {proposal.approver?.name ?? "a workspace member"} at <LocalTime date={proposal.approvedAt} />.</p>}
  </article>;
}

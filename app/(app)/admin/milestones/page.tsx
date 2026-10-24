import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { loadMilestoneSummaries, milestoneScopeFor } from "@/lib/milestone-stats";
import { dueDateValue } from "@/lib/milestones";
import { MilestoneManager } from "@/components/milestone-manager";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Milestones" };

export default async function AdminMilestonesPage() {
  const scope = await milestoneScopeFor(await requireUser());
  if (!scope.ok) {
    if (scope.forbidden) redirect("/milestones");
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-slate-900">Milestone management</h1>
        <p className="max-w-xl text-sm text-slate-600">
          Open an organization first. Milestones belong to one organization, not to every
          account on the site.
        </p>
        <Link href="/tenants" className="text-sm font-medium text-teal-700 hover:underline">
          Choose an organization
        </Link>
      </div>
    );
  }

  const milestones = await loadMilestoneSummaries({ tenantId: scope.tenantId });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/milestones" className="text-sm text-teal-700 hover:underline">
          ← Back to milestones
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">Milestone management</h1>
        <p className="text-sm text-slate-600">
          Group issues into a release or sprint. Closing a milestone keeps its issues; deleting one
          removes them from it without deleting them.
        </p>
      </div>
      <MilestoneManager
        milestones={milestones.map((m) => ({ ...m, dueDate: dueDateValue(m.dueDate) || null }))}
      />
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { ensureDefaultIssueTypes, issueTypeScopeFor } from "@/lib/issue-types";
import { AdminIssueTypesManager } from "@/components/admin-issue-types-manager";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Issue types" };

export default async function AdminTypesPage() {
  const scope = await issueTypeScopeFor(await requireUser());
  if (!scope.ok) {
    if (scope.forbidden) redirect("/issues");
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-slate-900">Issue type management</h1>
        <p className="max-w-xl text-sm text-slate-600">
          Open an organization first. Issue types belong to one organization, not to every
          account on the site.
        </p>
        <Link href="/tenants" className="text-sm font-medium text-teal-700 hover:underline">
          Choose an organization
        </Link>
      </div>
    );
  }

  await ensureDefaultIssueTypes(scope.tenantId);

  const [types, deletedRows] = await Promise.all([
    prisma.issueType.findMany({
      where: { tenantId: scope.tenantId },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { bugs: true },
        },
      },
    }),
    // As for platforms: deleted issues block deletion but the list hides them.
    prisma.bug.groupBy({
      by: ["typeId"],
      where: { tenantId: scope.tenantId, isDeleted: true, typeId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const deletedCounts = Object.fromEntries(
    deletedRows.map((row) => [row.typeId as string, row._count._all]),
  );

  return <AdminIssueTypesManager types={types} deletedCounts={deletedCounts} />;
}

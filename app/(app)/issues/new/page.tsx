import Link from "next/link";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { currentTenantAccess } from "@/lib/tenant-access";
import { getActiveIssueTypesCached, getActivePlatforms } from "@/lib/lookups";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { tenantMemberWhere } from "@/lib/tenant-mentions";
import { CreateIssueForm } from "@/components/create-issue-form";
import { activeProjectIdFor } from "@/lib/project-context";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Report an issue" };

type MentionUser = { id: string; name: string; role: Role; image: string | null };

/** The issues list already survives a lookup failure. This form did not, so one bad read showed "This page didn't load". */
async function loadOrEmpty<T>(label: string, load: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.error(`[issues/new] ${label} lookup failed`, error);
    return empty;
  }
}

async function loadMentionUsers(tenantId: string | null): Promise<MentionUser[]> {
  // #502: only members of the tenant the issue goes into can be mentioned.
  if (!tenantId) return [];
  const where = tenantMemberWhere(tenantId);
  try {
    return await prisma.user.findMany({
      where,
      select: { id: true, name: true, role: true, image: true },
      orderBy: { name: "asc" },
    });
  } catch (error) {
    console.error("[issues/new] user lookup failed, retrying without image", error);
    try {
      const rows = await prisma.user.findMany({
        where,
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      });
      return rows.map((row) => ({ ...row, image: null }));
    } catch (fallbackError) {
      console.error("[issues/new] user lookup failed", fallbackError);
      return [];
    }
  }
}

async function loadAssigneeUsers(tenantId: string | null): Promise<MentionUser[]> {
  if (!tenantId) return [];
  return loadOrEmpty("assignees", () =>
    prisma.user.findMany({
      where: { memberships: { some: { tenantId } } },
      select: { id: true, name: true, role: true, image: true },
      orderBy: { name: "asc" },
    }),
  []);
}

export default async function NewBugPage() {
  const user = await requireUser();
  const admin = (await currentTenantAccess(user.id, user.role)).admin;
  const tenantId = await currentTenantIdFor(user.id);
  // The tenant's members are needed for @mentions (#502); admins additionally
  // get the assignee picker. Each lookup fails on its own: the list page
  // already does this, and a throw here is the error page instead of the form.
  const [users, assigneeUsers, categories, types] = await Promise.all([
    loadMentionUsers(tenantId),
    loadAssigneeUsers(tenantId),
    // Cached (#297). getActivePlatforms also seeds the default platforms,
    // but only when they're actually missing — it used to upsert all three
    // on every render of this form.
    loadOrEmpty("platforms", async () => getActivePlatforms(tenantId), []),
    loadOrEmpty("issue types", () => getActiveIssueTypesCached(tenantId), []),
  ]);
  // The active project scopes the create-issue draft (#729): switching
  // projects must not surface this form's text in another project.
  const projectId = await loadOrEmpty("active project", async () => {
    if (!tenantId) return null;
    return activeProjectIdFor(prisma, tenantId);
  }, null);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href="/issues" className="text-sm text-teal-700 hover:underline">
          ← Back to issues
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">Report an issue</h1>
        <p className="text-sm text-slate-600">
          Include a type, clear description, and optional GitHub PR so the team
          can triage quickly.
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <CreateIssueForm
          users={users}
          assigneeUsers={assigneeUsers}
          categories={categories}
          types={types}
          isAdmin={admin}
          currentUserId={user.id}
          projectId={projectId}
        />
      </div>
    </div>
  );
}

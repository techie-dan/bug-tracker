import { headers } from "next/headers";
import { ReportIssueFab } from "@/components/report-issue-fab";
import { auth } from "@/auth";
import { requireUser } from "@/lib/auth-helpers";
import { isLinkPreviewBot } from "@/lib/link-preview";
import { AppHeader } from "@/components/app-header";
import { getUnreadCount } from "@/lib/lookups";
import { REPORT_FORM_URL } from "@/lib/report-form";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/skip-link";
import { PAGE_CONTAINER_CLASS } from "@/components/page-container";
import { FocusMainOnNavigate } from "@/components/focus-main-on-navigate";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { isAdmin } from "@/lib/roles";
import { isTenantAdminRole } from "@/lib/agents/membership";
import type { WorkspaceChoice } from "@/components/workspace-switcher";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { tenantsForUser } from "@/lib/tenants";
import { countPendingEscalations } from "@/lib/agent-questions";
import { pointTotals } from "@/lib/points/leaderboard";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Link-preview crawlers may reach /bugs/[id] without a session. Render a
  // minimal shell so generateMetadata + the public preview body can respond.
  if (!session?.user) {
    const ua = (await headers()).get("user-agent");
    if (isLinkPreviewBot(ua)) {
      return (
        <div className="flex min-h-screen flex-col bg-slate-50">
          <main
            id={MAIN_CONTENT_ID}
            className={`${PAGE_CONTAINER_CLASS} flex-1 py-8`}
          >
            {children}
          </main>
        </div>
      );
    }
  }

  const user = await requireUser();
  // The header lists this person's workspaces. Pages still resolve the active
  // project inside the current workspace, so a foreign project id is ignored.
  let workspaces: WorkspaceChoice[] = [];
  let activeTenantId: string | null = null;
  let canManagePlatforms = false;
  let tenantId: string | null = null;
  try {
    tenantId = await currentTenantIdFor(user.id);
    activeTenantId = tenantId;
    const memberships = await tenantsForUser(prisma, user.id);
    workspaces = memberships
      .filter((tenant) => tenant.archivedAt === null)
      .map((tenant) => ({ id: tenant.id, name: tenant.name, slug: tenant.slug }));
    if (tenantId) {
      const membership = await prisma.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: user.id } },
        select: { role: true },
      });
      canManagePlatforms = isTenantAdminRole(membership?.role, user.role);
    }
  } catch (error) {
    console.error("[layout] workspace context failed", error);
  }
  // A missing Notification table must not take down every signed-in page.
  let unreadCount = 0;
  try {
    // Cached per user and expired by every write that changes it (#317), so
    // ordinary navigation doesn't pay for a count query.
    unreadCount = await getUnreadCount(user.id);
  } catch (error) {
    console.error("[layout] notification count failed", error);
  }

  let pendingEscalationsCount = 0;
  let points = 0;
  let solvedTasks = 0;
  if (tenantId) {
    try {
      pendingEscalationsCount = await countPendingEscalations(user.id, tenantId);
    } catch (error) {
      console.error("[layout] pending escalations count failed", error);
    }
    try {
      const totals = await pointTotals(prisma, tenantId, user.id);
      points = totals.points;
      solvedTasks = totals.solvedTasks;
    } catch (error) {
      console.error("[layout] points failed", error);
    }
  }

  // #287: one primary-key read; a failure leaves shortcuts on, the default.
  let shortcutsEnabled = true;
  try {
    const prefs = await prisma.user.findUnique({
      where: { id: user.id },
      select: { keyboardShortcuts: true },
    });
    shortcutsEnabled = prefs?.keyboardShortcuts ?? true;
  } catch (error) {
    console.error("[layout] shortcut setting failed", error);
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <SkipLink />
      <AppHeader
        userName={user.name ?? user.email}
        userImage={user.image}
        role={user.role}
        isRealSuperAdmin={user.isRealSuperAdmin}
        isRealAdmin={user.isRealAdmin}
        unreadCount={unreadCount}
        pendingEscalationsCount={pendingEscalationsCount}
        userId={user.id}
        workspaces={workspaces}
        activeTenantId={activeTenantId}
        canManagePlatforms={canManagePlatforms}
        points={points}
        solvedTasks={solvedTasks}
      />
      <main
        id={MAIN_CONTENT_ID}
        /* Focusable so the skip link and the route announcer can move focus
           here; -1 keeps it out of the normal tab order. */
        tabIndex={-1}
        className={`outline-none ${PAGE_CONTAINER_CLASS} flex-1 pt-5 sm:pt-8 ${
          // #221: the fixed FAB sits over the bottom-right of the viewport and
          // was covering pagination "Next" and the Danger-zone Delete button.
          // Reserve clearance only when the FAB actually renders, so we don't
          // leave dead space in deployments without REPORT_FORM_URL.
          REPORT_FORM_URL ? "pb-20 sm:pb-24" : "pb-5 sm:pb-8"
        }`}
      >
        {children}
      </main>
      <ReportIssueFab href={REPORT_FORM_URL} />
      <FocusMainOnNavigate />
      <KeyboardShortcuts
        enabled={shortcutsEnabled}
        dashboard={isAdmin(user.role)}
      />
    </div>
  );
}

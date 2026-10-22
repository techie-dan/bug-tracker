import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth-helpers";
import { openInvitesFor, viewInvite } from "@/lib/invites";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/roles";
import { currentTenantIdFor } from "@/lib/tenant-context";
import {
  MEMBERSHIP_ROLE_LABELS,
  TENANT_NAME_MAX,
  tenantsForUser,
  zeduNeedsOwner,
} from "@/lib/tenants";
import { selectTenantAction, setTenantArchivedAction } from "./actions";
import { CreateTenantForm } from "./create-tenant-form";
import { AcceptInviteForm } from "./accept-invite-form";
import { InviteCard } from "./invite-card";
import { InviteLinkForm } from "./invite-link-form";
import { ZeduOwnerForm } from "./zedu-owner-form";
import { LocalTime } from "@/components/local-time";
import { discoverableTenants, requestsForUser } from "@/lib/tenant-join-requests";
import { JoinWorkspaceForm } from "./join-workspace-form";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Workspaces" };

const card = "rounded-xl border border-slate-200 bg-white p-4 sm:p-6";

/**
 * Where a person picks the tenant to work in, creates one, or accepts an
 * invite (#444). Memberships are listed under Your tenants. An invite that
 * is still open for this account is listed above them, with a join button.
 */
export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{
    invite?: string | string[];
    error?: string | string[];
    notice?: string | string[];
  }>;
}) {
  const user = await requireUser();
  // In-app invite notifications (#443) link here with the invite's id.
  const {
    invite: inviteParam,
    error: errorParam,
    notice: noticeParam,
  } = await searchParams;
  const inviteId = typeof inviteParam === "string" ? inviteParam : "";
  const error = typeof errorParam === "string" ? errorParam : "";
  const notice = typeof noticeParam === "string" ? noticeParam : "";

  const [tenants, currentTenantId, invite, zeduOwnerNeeded, openInvites] = await Promise.all([
    tenantsForUser(prisma, user.id),
    currentTenantIdFor(user.id),
    inviteId ? viewInvite(prisma, { inviteId }, user) : null,
    isSuperAdmin(user.role) ? zeduNeedsOwner(prisma) : false,
    openInvitesFor(prisma, user),
  ]);
  const listedInvites = openInvites.filter((row) => row.id !== inviteId);
  const activeTenants = tenants.filter((tenant) => !tenant.archivedAt);
  const archivedTenants = tenants.filter(
    (tenant) => tenant.archivedAt && tenant.role === "owner",
  );
  const hasTenants = activeTenants.length > 0;
  // #537: names shared by two of your tenants, so their buttons say which is which.
  const nameCounts = new Map<string, number>();
  for (const tenant of activeTenants) {
    const key = tenant.name.toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const sharesName = (name: string) => (nameCounts.get(name.toLocaleLowerCase()) ?? 0) > 1;
  const [discoverable, joinRequests] = await Promise.all([
    !hasTenants && !inviteId ? discoverableTenants(prisma, user.id) : Promise.resolve([]),
    requestsForUser(prisma, user.id),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">
          {hasTenants ? "Choose a workspace" : "Join or create a workspace"}
        </h1>
        <p className="text-sm text-slate-600">
          {hasTenants
            ? "A workspace is your team. A project is one product inside it. A platform, such as Web or Mobile, is only a label on an issue."
            : "You're not in a workspace yet. Accept an invite, or create a workspace of your own."}
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
          {notice}
        </p>
      ) : null}

      {inviteId ? (
        <InviteCard invite={invite} accept={{ inviteId }} accountEmail={user.email} />
      ) : null}

      {listedInvites.length > 0 ? (
        <section aria-labelledby="your-invites" className="overflow-hidden rounded-xl border border-teal-200 bg-white">
          <h2
            id="your-invites"
            className="border-b border-teal-200 bg-teal-50 px-4 py-3 text-base font-semibold text-slate-900 sm:px-6"
          >
            Invitations
          </h2>
          <ul className="divide-y divide-slate-200">
            {listedInvites.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{row.tenant.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {row.invitedByName} invited you · expires <LocalTime date={row.expiresAt} />
                  </p>
                </div>
                <AcceptInviteForm inviteId={row.id} tenantName={row.tenant.name} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {joinRequests.length > 0 ? (
        <section aria-labelledby="your-join-requests" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h2 id="your-join-requests" className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900 sm:px-6">
            Your workspace requests
          </h2>
          <ul className="divide-y divide-slate-200">
            {joinRequests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{request.tenant.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">Requested <LocalTime date={request.requestedAt} /></p>
                </div>
                <Badge className={request.status === "approved" ? "bg-teal-50 text-teal-800 ring-1 ring-teal-200" : request.status === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"}>
                  {request.status === "pending" ? "Request Pending" : request.status[0]!.toUpperCase() + request.status.slice(1)}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!hasTenants && !inviteId ? (
        <>
          {/* #641: a newcomer's first step is their own workspace, explained. */}
          <section aria-labelledby="how-ziki-works" className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 sm:p-6">
            <h2 id="how-ziki-works" className="text-base font-semibold text-slate-900">
              How Ziki is organised
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
              <li>
                <span className="font-medium">A workspace</span> is your team or company. Its people, projects,
                and issues stay inside it.
              </li>
              <li>
                <span className="font-medium">A project</span> is one product in that workspace, such as a web
                app or a desktop app. The switcher chooses which project&apos;s issues you see.
              </li>
              <li>
                <span className="font-medium">A platform</span> is a label on an issue, such as Web or Mobile.
                It is not a product, and every project in the workspace uses the same list.
              </li>
            </ul>
          </section>
          <section aria-labelledby="create-tenant-first" className={card}>
            <h2 id="create-tenant-first" className="text-base font-semibold text-slate-900">
              Create your workspace
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              It takes one name. You&apos;ll be its owner, and a first project is created with it.
            </p>
            <CreateTenantForm nameMax={TENANT_NAME_MAX} />
          </section>
          <section aria-labelledby="discover-workspaces" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <h2 id="discover-workspaces" className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900 sm:px-6">
              Discover workspaces
            </h2>
            {discoverable.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-600 sm:px-6">No workspaces are currently accepting join requests. You can still join with an invite or create a workspace.</p>
            ) : (
              <ul className="divide-y divide-slate-200">
                {discoverable.map((tenant) => (
                  <li key={tenant.id} className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{tenant.name}</p>
                      {tenant.description ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{tenant.description}</p> : null}
                      {tenant.memberships[0]?.user.name ? <p className="mt-1 text-xs text-slate-500">Owner: {tenant.memberships[0].user.name}</p> : null}
                    </div>
                    <JoinWorkspaceForm tenantId={tenant.id} pending={tenant.joinRequests[0]?.status === "pending"} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {hasTenants ? (
        <section aria-labelledby="your-tenants" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <h2
            id="your-tenants"
            className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900 sm:px-6"
          >
            Your workspaces
          </h2>
          <ul className="divide-y divide-slate-200">
            {activeTenants.map((tenant) => {
              const current = tenant.id === currentTenantId;
              return (
                <li key={tenant.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                      <span className="truncate">{tenant.name}</span>
                      {current ? (
                        <Badge className="bg-teal-50 text-teal-800 ring-1 ring-teal-200">Current</Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {/* #537: the slug tells tenants with the same name apart. */}
                      <span className="font-mono">{tenant.slug}</span> · {MEMBERSHIP_ROLE_LABELS[tenant.role]} ·{" "}
                      <Link href={`/tenants/${tenant.slug}`} className="text-teal-700 hover:underline">
                        People and invites
                      </Link>
                    </p>
                  </div>
                  <form action={selectTenantAction}>
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <Button type="submit" variant={current ? "secondary" : "primary"}>
                      Open {tenant.name}
                      {sharesName(tenant.name) ? <span className="sr-only"> ({tenant.slug})</span> : null}
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {archivedTenants.length > 0 ? (
        <section
          aria-labelledby="archived-tenants"
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          <h2
            id="archived-tenants"
            className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-900 sm:px-6"
          >
            Archived workspaces
          </h2>
          <p className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600 sm:px-6">
            Archived workspaces are hidden from the switcher and can&apos;t be opened. Restore one
            to work in it again.
          </p>
          <ul className="divide-y divide-slate-200">
            {archivedTenants.map((tenant) => (
              <li
                key={tenant.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{tenant.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    <span className="font-mono">{tenant.slug}</span> · Archived · {MEMBERSHIP_ROLE_LABELS[tenant.role]}
                  </p>
                </div>
                <form action={setTenantArchivedAction}>
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <input type="hidden" name="archived" value="false" />
                  <Button type="submit" variant="secondary">
                    Restore {tenant.name}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="join-with-invite" className={card}>
        <h2 id="join-with-invite" className="text-base font-semibold text-slate-900">
          Join with an invite
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {hasTenants
            ? "Workspaces are invite-only. Open the link an owner or admin sent you, or paste it here."
            : "Joining your team instead? Open the invite link an owner or admin sent you, or paste it here."}
        </p>
        <InviteLinkForm />
      </section>

      {hasTenants || inviteId ? (
        <section aria-labelledby="create-tenant" className={card}>
          <h2 id="create-tenant" className="text-base font-semibold text-slate-900">
            Create a workspace
          </h2>
          <CreateTenantForm nameMax={TENANT_NAME_MAX} />
        </section>
      ) : null}

      {zeduOwnerNeeded ? (
        <section aria-labelledby="zedu-owner" className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-6">
          <h2 id="zedu-owner" className="text-base font-semibold text-amber-900">
            Ziki has no owner yet
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            Everyone moved into Ziki is a member, so nobody can invite people. As the site&apos;s
            super admin, choose its first owner from its existing members.
          </p>
          <ZeduOwnerForm />
        </section>
      ) : null}
    </div>
  );
}

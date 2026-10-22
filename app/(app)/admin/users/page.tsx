import Link from "next/link";
import { Suspense } from "react";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { tenantMemberWhere } from "@/lib/membership-admin";
import { MEMBERSHIP_ROLE_LABELS } from "@/lib/tenants";
import { currentTenantAccess } from "@/lib/tenant-access";
import { toSingleQueryParam } from "@/lib/search";
import { LocalTime } from "@/components/local-time";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { MemberRoleActions } from "@/components/member-role-actions";
import { UserSearch } from "@/components/user-search";
import { PaginationControls } from "@/components/pagination-controls";
import { calculatePagination } from "@/lib/pagination";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Admins" };

const roleBadgeClass = {
  member: "bg-slate-100 text-slate-700",
  admin: "bg-teal-100 text-teal-800",
  owner: "bg-amber-100 text-amber-900",
} as const;

/**
 * People in the organization you're working in, ordered owner → admin →
 * member. MembershipRole is declared in that order, and Postgres sorts enums
 * by declaration, so `role: "asc"` is that order.
 */
const USERS_PER_PAGE = 25;

type SearchParams = Promise<{
  q?: string | string[];
  page?: string | string[];
  [key: string]: string | string[] | undefined;
}>;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const actor = await requireSuperAdmin();
  const access = await currentTenantAccess(actor.id, actor.role);

  const params = searchParams ? await searchParams : {};
  const query = toSingleQueryParam(params.q)?.trim() ?? "";

  const tenantId = access.tenantId;
  const tenantName = access.tenantName;
  const tenantSlug = access.tenantSlug;
  if (!tenantId || !tenantName || !tenantSlug) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Admin management</h1>
        <p className="max-w-xl text-sm text-slate-600">
          Open an organization first. Roles on this page belong to one organization,
          not to every account on the site.
        </p>
        <Link href="/tenants" className="text-sm font-medium text-teal-700 hover:underline">
          Choose an organization
        </Link>
      </div>
    );
  }

  const where = tenantMemberWhere(tenantId, query);
  const totalCount = await prisma.membership.count({ where });
  const pagination = calculatePagination({
    page: params.page,
    pageSize: USERS_PER_PAGE,
    totalCount,
  });

  const [members, ownerCount] = await Promise.all([
    prisma.membership.findMany({
      where,
      orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
      skip: pagination.skip,
      take: pagination.take,
      select: {
        role: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, email: true, image: true, role: true },
        },
      },
    }),
    prisma.membership.count({ where: { tenantId, role: "owner" } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Admin management</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            People in <span className="font-medium text-slate-800">{tenantName}</span>.
            Promoting someone makes them an admin of this organization only. Accounts from
            another organization are not listed here, and a site-wide admin title does not
            make someone an admin of {tenantName}.
          </p>
          <p className="mt-2 text-sm">
            <Link
              href={`/tenants/${tenantSlug}`}
              className="font-medium text-teal-700 hover:underline"
            >
              Invites for {tenantName}
            </Link>
            <span className="text-slate-400"> · </span>
            <Link href="/tenants" className="font-medium text-teal-700 hover:underline">
              Switch organization
            </Link>
          </p>
        </div>
        <div className="w-full sm:w-auto">
          <Suspense
            fallback={<div className="h-9 w-full animate-pulse rounded-lg bg-slate-100 sm:w-64" />}
          >
            <UserSearch />
          </Suspense>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {members.length > 0 ? (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">User</th>
                <th className="whitespace-nowrap px-4 py-3">Role</th>
                <th className="whitespace-nowrap px-4 py-3">Joined</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((member) => (
                <tr key={member.user.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={member.user.name} image={member.user.image} size="md" />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{member.user.name}</div>
                        <div className="break-all text-xs text-slate-500 sm:text-sm">{member.user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className={roleBadgeClass[member.role]}>
                        {MEMBERSHIP_ROLE_LABELS[member.role]}
                      </Badge>
                      {member.user.role === "super_admin" ? (
                        <Badge className="bg-amber-100 text-amber-900">Site super admin</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    <LocalTime date={member.createdAt} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <MemberRoleActions
                      tenantId={tenantId}
                      tenantName={tenantName}
                      userId={member.user.id}
                      userName={member.user.name}
                      membershipRole={member.role}
                      siteSuperAdmin={member.user.role === "super_admin"}
                      canChangeRoles
                      canRemove
                      isSelf={member.user.id === actor.id}
                      ownerCount={ownerCount}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : query ? (
          <div className="px-4 py-12 text-center">
            <p className="font-medium text-slate-800">
              No one in {tenantName} matching &ldquo;{query}&rdquo;
            </p>
            <p className="mt-1 text-sm text-slate-500">
              This search only looks at people who have joined {tenantName}.
            </p>
            <Link
              href="/admin/users"
              className="mt-3 inline-flex text-sm font-medium text-teal-700 hover:underline"
            >
              Clear search
            </Link>
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            No one has joined {tenantName} yet.
          </p>
        )}
      </div>

      <PaginationControls
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalCount={pagination.totalCount}
        from={pagination.from}
        to={pagination.to}
        queryParams={{ q: query || undefined }}
        basePath="/admin/users"
        itemLabel="user"
      />
    </div>
  );
}

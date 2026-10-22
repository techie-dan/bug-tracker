import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { bugInTenant, currentTenantIdFor } from "@/lib/tenant-context";
import { pointTotals } from "@/lib/points/leaderboard";
import { pointBalance } from "@/lib/points/balance";
import { PointsSummary } from "@/components/points-summary";
import { requireUser } from "@/lib/auth-helpers";
import { canViewProfile, canViewWallet } from "@/lib/profile-access";
import { roleLabels } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/local-time";
import { statusClass, statusLabels } from "@/lib/labels";
import { teamAgentsForMember } from "@/lib/team-directory";
import { TeamAgentList } from "@/components/team-agent-list";

type ProfileProps = { params: Promise<{ id: string }> };

/** How many of each list to show before pointing at the filtered list. */
const RECENT = 10;

const roleBadgeClass: Record<string, string> = {
  user: "bg-slate-100 text-slate-700",
  admin: "bg-teal-100 text-teal-800",
  super_admin: "bg-amber-100 text-amber-900",
};

export async function generateMetadata({
  params,
}: ProfileProps): Promise<Metadata> {
  const { id } = await params;
  const viewer = await requireUser();
  // #503: the name is in the tab title, so it gets the same check as the page.
  const user = (await canViewProfile(prisma, viewer, id))
    ? await prisma.user.findUnique({ where: { id }, select: { name: true } })
    : null;
  return {
    title: user ? user.name : "Person not found",
    robots: { index: false, follow: false },
  };
}

export default async function ProfilePage({ params }: ProfileProps) {
  const viewer = await requireUser();
  const { id } = await params;
  // #503: only people who share a tenant with this person can see them.
  if (!(await canViewProfile(prisma, viewer, id))) notFound();
  // #428: points in the viewer's tenant.
  const tenantId = await currentTenantIdFor(viewer.id);
  // #425, #439: a profile is another way to read issues. No membership, no issues.
  const scope = bugInTenant(tenantId);

  const [person, reported, assigned, counts, assignedTotal] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, createdAt: true, walletAddress: true },
    }),
    prisma.bug.findMany({
      where: { reporterId: id, isDeleted: false, ...scope },
      select: { id: true, title: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: RECENT,
    }),
    prisma.bug.findMany({
      where: { assigneeId: id, isDeleted: false, ...scope },
      select: { id: true, title: true, status: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: RECENT,
    }),
    prisma.bug.groupBy({
      by: ["status"],
      where: { reporterId: id, isDeleted: false, ...scope },
      _count: { _all: true },
    }),
    // Counted rather than taken from `assigned.length`, which stops at RECENT
    // and would quietly under-report anyone with more than that.
    prisma.bug.count({ where: { assigneeId: id, isDeleted: false, ...scope } }),
  ]);

  if (!person) notFound();

  const points = tenantId
    ? await pointTotals(prisma, tenantId, person.id)
    : { points: 0, solvedTasks: 0 };
  // #618: the ledger balance behind those points, and the wallet address that
  // only they and workspace admins may see.
  const [balance, walletVisible] = await Promise.all([
    tenantId ? pointBalance(prisma, { tenantId, userId: person.id }) : Promise.resolve(null),
    canViewWallet(prisma, viewer, person.id, tenantId),
  ]);

  const reportedTotal = counts.reduce((sum, row) => sum + row._count._all, 0);
  const resolved =
    counts.find((row) => row.status === "resolved")?._count._all ?? 0;
  const tenantMembership = tenantId
    ? await prisma.membership.findFirst({
        where: { tenantId, userId: person.id },
        select: { id: true },
      })
    : null;
  const agents = tenantId && tenantMembership
    ? await teamAgentsForMember(prisma, tenantId, person.id)
    : [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/issues" className="text-sm text-teal-700 hover:underline">
          ← Back to issues
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold text-slate-900">
          {person.name}
          <Badge className={roleBadgeClass[person.role]}>
            {roleLabels[person.role]}
          </Badge>
        </h1>
        <p className="text-sm text-slate-600">
          Joined <LocalTime date={person.createdAt} />
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Issues reported" value={reportedTotal} />
        <Stat label="Of those, resolved" value={resolved} />
        <Stat label="Currently assigned" value={assignedTotal} />
      </dl>

      <PointsSummary points={points.points} solvedTasks={points.solvedTasks} />

      {balance || (walletVisible && person.walletAddress) ? (
        <section
          className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
          aria-labelledby="balance-heading"
        >
          <h2
            id="balance-heading"
            className="text-sm font-semibold uppercase tracking-wide text-slate-500"
          >
            Balance
          </h2>
          {balance ? (
            <>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {balance.lifetime.points}
                <span className="ml-1 text-sm font-normal text-slate-600">
                  point{balance.lifetime.points === 1 ? "" : "s"}
                </span>
              </p>
              <p className="text-sm text-slate-600">
                {balance.lifetime.entries} ledger entr
                {balance.lifetime.entries === 1 ? "y" : "ies"}, corrections included
              </p>
            </>
          ) : null}
          {walletVisible && person.walletAddress ? (
            <p className="mt-2 break-all font-mono text-sm text-slate-700">
              <span className="font-sans font-medium text-slate-600">Wallet </span>
              {person.walletAddress}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="profile-agents-heading">
        <h2 id="profile-agents-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Agents
        </h2>
        <TeamAgentList agents={agents} />
      </section>

      <IssueList
        heading="Reported"
        empty="Hasn't reported an issue yet."
        issues={reported}
        total={reportedTotal}
      />
      <IssueList
        heading="Assigned"
        empty="Nothing assigned right now."
        issues={assigned}
        total={assignedTotal}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {value}
      </dd>
    </div>
  );
}

type ProfileIssue = {
  id: string;
  title: string;
  status: keyof typeof statusLabels;
};

function IssueList({
  heading,
  empty,
  issues,
  total,
}: {
  heading: string;
  empty: string;
  issues: ProfileIssue[];
  total?: number;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {heading}
        {total !== undefined && total > issues.length ? (
          <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">
            showing the {issues.length} most recent of {total}
          </span>
        ) : null}
      </h2>
      {issues.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {issues.map((issue) => (
            <li key={issue.id}>
              <Link
                href={`/issues/${issue.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm transition hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1 break-words font-medium text-slate-900">
                  {issue.title}
                </span>
                <Badge className={statusClass[issue.status]}>
                  {statusLabels[issue.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

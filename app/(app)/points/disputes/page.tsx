import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { isTenantAdmin } from "@/lib/agents/membership";
import { isAdmin } from "@/lib/roles";
import {
  disputesForMember,
  entriesForMember,
  openDisputes,
  type DisputeView,
} from "@/lib/points/disputes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/local-time";
import { DisputeControls } from "./dispute-controls";
import { CreditAwardsForm } from "./credit-awards-form";

export const metadata = { title: "Points disputes" };

const statusClass: Record<DisputeView["status"], string> = {
  open: "bg-amber-100 text-amber-900",
  granted: "bg-teal-100 text-teal-900",
  rejected: "bg-slate-200 text-slate-700",
};

const statusLabel: Record<DisputeView["status"], string> = {
  open: "Open",
  granted: "Granted",
  rejected: "Rejected",
};

function DisputeCard({ dispute, children }: { dispute: DisputeView; children?: ReactNode }) {
  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={statusClass[dispute.status]}>{statusLabel[dispute.status]}</Badge>
        <Badge className="bg-slate-100 text-slate-700">
          {dispute.kind === "wrong" ? "Wrong entry" : "Missing award"}
        </Badge>
        {dispute.kind === "missing" && dispute.requestedRole ? (
          <Badge className="bg-slate-100 text-slate-700">
            Requested: {dispute.requestedRole === "solver" ? "Solver" : "Reporter"}
          </Badge>
        ) : null}
        <Link
          href={`/issues/${dispute.bugId}`}
          className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 hover:underline"
        >
          #{dispute.bugNumber} {dispute.bugTitle}
        </Link>
        <span className="text-xs text-slate-500">
          by {dispute.openerName} · <LocalTime date={dispute.createdAt} />
        </span>
      </div>
      {dispute.entry ? (
        <p className="text-xs text-slate-600">
          Entry: {dispute.entry.points > 0 ? "+" : ""}
          {dispute.entry.points} pts ({dispute.entry.role}) · {dispute.entry.id}
        </p>
      ) : null}
      <p className="text-sm text-slate-700">{dispute.reason}</p>
      {dispute.resolution ? (
        <p className="text-sm text-slate-600">
          Resolution: {dispute.resolution}
          {dispute.resolvedAt ? (
            <>
              {" · "}
              <LocalTime date={dispute.resolvedAt} />
            </>
          ) : null}
        </p>
      ) : null}
      {children}
    </li>
  );
}

/** Open a dispute on your own points, or resolve others' as an admin (#436). */
export default async function PointsDisputesPage() {
  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  if (!tenantId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Points disputes</h1>
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          You&apos;re not a member of a workspace yet, so there are no points to dispute.
        </p>
      </div>
    );
  }

  const admin = isAdmin(user.role) || (await isTenantAdmin(user, tenantId));
  const [mine, queue, entries] = await Promise.all([
    disputesForMember(prisma, { tenantId, userId: user.id }),
    admin ? openDisputes(prisma, tenantId) : Promise.resolve([]),
    entriesForMember(prisma, { tenantId, userId: user.id }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Points disputes</h1>
          <p className="text-sm text-slate-600">
            Say an award is missing or wrong; a workspace admin resolves it. Points are never
            deleted — a correction is a reversing entry.
          </p>
        </div>
        <Link href="/points/disputes/new">
          <Button type="button" className="px-3 py-1.5 text-xs">
            Open a dispute
          </Button>
        </Link>
      </div>

      {admin ? (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Credit missing awards</h2>
          <p className="text-sm text-slate-600">
            Solver points are written when an assigned issue is marked resolved. Reporter points
            are written when two independent reviewers accept the issue as real. Use this when
            that award is missing.
          </p>
          <CreditAwardsForm />
        </section>
      ) : null}

      {admin ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Open queue <span className="text-sm font-normal text-slate-500">({queue.length})</span>
          </h2>
          {queue.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              No open disputes.
            </p>
          ) : (
            <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {queue.map((dispute) => (
                <DisputeCard key={dispute.id} dispute={dispute}>
                  <DisputeControls dispute={dispute} />
                </DisputeCard>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Your disputes</h2>
        {mine.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            You haven&apos;t disputed anything yet.
          </p>
        ) : (
          <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {mine.map((dispute) => (
              <DisputeCard key={dispute.id} dispute={dispute} />
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Your points entries</h2>
        {entries.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            No points yet. Resolve an assigned issue to earn the first ones.
          </p>
        ) : (
          <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <span className="w-16 text-right text-sm font-semibold tabular-nums text-slate-900">
                  {entry.points > 0 ? "+" : ""}
                  {entry.points}
                </span>
                <Badge className="bg-slate-100 text-slate-700">{entry.role}</Badge>
                {entry.bugNumber !== null ? (
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                    #{entry.bugNumber}
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 text-sm text-slate-500">No issue linked</span>
                )}
                {entry.correctedAt ? (
                  <Badge className="bg-amber-100 text-amber-900">Corrected</Badge>
                ) : (
                  <Link href={`/points/disputes/new?entry=${entry.id}${entry.bugNumber !== null ? `&bug=${entry.bugNumber}` : ""}`}>
                    <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs">
                      Dispute
                    </Button>
                  </Link>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

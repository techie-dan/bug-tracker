import { prisma } from "@/lib/prisma";
import { describeBudget, type GoalSplitStatus } from "@/lib/goals/pool-split";
import { Badge } from "@/components/ui/badge";
import type { GoalStatus } from "@prisma/client";

/**
 * Goal budgets for the issue view (#616): the project's goals with their pool
 * utilization, split status, and — on an issue — how much each goal reserved
 * for that issue. Server component: it reads Prisma directly, so the panel
 * renders with the page and needs no client fetch.
 */

const GOAL_STATUS_BADGE: Record<GoalStatus, string> = {
  active: "border border-teal-200 bg-teal-50 text-teal-900",
  completed: "border border-emerald-200 bg-emerald-50 text-emerald-900",
  cancelled: "border border-slate-200 bg-slate-100 text-slate-600",
};

const SPLIT_STATUS_BADGE: Record<GoalSplitStatus, string> = {
  "no-budget": "border border-slate-200 bg-slate-100 text-slate-600",
  unfunded: "border border-amber-200 bg-amber-50 text-amber-900",
  "partially-split": "border border-sky-200 bg-sky-50 text-sky-900",
  "fully-split": "border border-emerald-200 bg-emerald-50 text-emerald-900",
};

const SPLIT_STATUS_LABEL: Record<GoalSplitStatus, string> = {
  "no-budget": "No budget",
  unfunded: "Unfunded",
  "partially-split": "Partially split",
  "fully-split": "Fully split",
};

const PROGRESS_BAR: Record<GoalSplitStatus, string> = {
  "no-budget": "bg-slate-300",
  unfunded: "bg-amber-400",
  "partially-split": "bg-sky-500",
  "fully-split": "bg-emerald-500",
};

type GoalBudgetSectionProps = {
  /** Tenant the goals belong to, taken from the loaded issue. */
  tenantId: string;
  /** Project whose goals are shown. */
  projectId: string;
  /** When set, each goal also shows the credits it reserved for this issue. */
  bugId?: string;
};

/**
 * Renders the project's goal budgets, newest first (capped at 6), or nothing
 * when the project has no goals yet.
 *
 * @param props - Tenant/project scope plus the optional current issue.
 * @returns A server-rendered `<section>` of goal budget rows, or `null`.
 */
export async function GoalBudgetSection({ tenantId, projectId, bugId }: GoalBudgetSectionProps) {
  const goals = await prisma.goal.findMany({
    where: { tenantId, projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 6,
    select: {
      id: true,
      title: true,
      status: true,
      budgetPool: true,
      allocated: true,
      // Without an issue in view the match on `id` never hits, so the shape
      // stays the same whether or not `bugId` is set.
      allocations: {
        where: { releasedAt: null, ...(bugId ? { targetBugId: bugId } : { id: { in: [] } }) },
        select: { amount: true },
      },
    },
  });

  if (!goals.length) return null;

  return (
    <section
      aria-label="Goal budgets"
      className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 print:hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Goal budgets</h2>
        <span className="text-xs text-slate-500">
          {goals.length} {goals.length === 1 ? "goal" : "goals"} in this project
        </span>
      </div>
      <ul className="mt-3 space-y-3">
        {goals.map((goal) => {
          const budget = describeBudget(goal.budgetPool, goal.allocated);
          const contribution = goal.allocations.reduce((sum, row) => sum + row.amount, 0);
          return (
            <li
              key={goal.id}
              className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"
              data-testid="goal-budget-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{goal.title}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                    {budget.allocated} of {budget.budgetPool} credits split · {budget.remaining} left ·{" "}
                    {budget.utilizationPercent}%
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge className={GOAL_STATUS_BADGE[goal.status]}>{goal.status}</Badge>
                  <Badge className={SPLIT_STATUS_BADGE[budget.splitStatus]}>
                    {SPLIT_STATUS_LABEL[budget.splitStatus]}
                  </Badge>
                </div>
              </div>
              <div
                aria-hidden="true"
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
              >
                <div
                  className={`h-full rounded-full ${PROGRESS_BAR[budget.splitStatus]}`}
                  style={{ width: `${budget.utilizationPercent}%` }}
                />
              </div>
              {contribution > 0 ? (
                <p className="mt-1.5 text-xs font-medium tabular-nums text-teal-700">
                  {contribution} credit{contribution === 1 ? "" : "s"} reserved for this issue
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { paginatedTenantLeaderboard, DEFAULT_LEADERBOARD_LIMIT } from "@/lib/points/leaderboard";
import { TARGET_POINTS } from "@/lib/points/rules";
import { Avatar } from "@/components/avatar";

export const metadata = { title: "Leaderboard" };

/** One shape for every leaderboard link, so the redirect and Previous/Next agree. */
function leaderboardHref(page: number, limit: number): string {
  return `/leaderboard?page=${page}&limit=${limit}`;
}

/** Members of the current tenant ranked by points (#428, #657). */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; limit?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(10, parseInt(params.limit ?? String(DEFAULT_LEADERBOARD_LIMIT), 10) || DEFAULT_LEADERBOARD_LIMIT));

  const user = await requireUser();
  const tenantId = await currentTenantIdFor(user.id);
  const { entries: rows, total, totalPages } = tenantId
    ? await paginatedTenantLeaderboard(prisma, tenantId, { page, limit })
    : { entries: [], total: 0, totalPages: 0 };

  // A page past the end (an old link, a hand-edited URL) would otherwise show
  // "No points yet" on a leaderboard that has points. Send it to the last page.
  if (total > 0 && page > totalPages) redirect(leaderboardHref(totalPages, limit));

  const startIdx = total === 0 ? 0 : (page - 1) * limit + 1;
  const endIdx = Math.min(page * limit, total);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Leaderboard</h1>
          <p className="text-sm text-slate-600">
            Points for solving, reporting and reviewing issues. The goal is {TARGET_POINTS} points.
          </p>
        </div>
        <Link href="/points/disputes" className="text-sm font-medium text-teal-700 hover:underline">
          Disputes
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No points yet. Resolve an assigned issue to earn the first ones.
        </p>
      ) : (
        <div className="space-y-4">
          <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {rows.map((row) => (
              <li
                key={row.userId}
                className={`flex items-center gap-3 px-4 py-3 ${row.userId === user.id ? "bg-teal-50" : ""}`}
              >
                <span className="w-8 text-right text-sm font-semibold tabular-nums text-slate-500">
                  {row.rank}
                </span>
                <Avatar name={row.name} image={row.image} />
                <Link href={`/users/${row.userId}`} className="min-w-0 flex-1 truncate font-medium text-slate-900 hover:underline">
                  {row.name}
                  {row.userId === user.id ? <span className="ml-1 text-sm font-normal text-slate-500">(you)</span> : null}
                </Link>
                <span className="text-sm tabular-nums text-slate-600">
                  {row.solvedTasks} solved
                </span>
                <span className="w-20 text-right font-semibold tabular-nums text-slate-900">
                  {row.points} pts
                </span>
              </li>
            ))}
          </ol>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-2 text-sm text-slate-600">
              <div>
                Showing {startIdx}–{endIdx} of {total}
              </div>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link
                    href={leaderboardHref(page - 1, limit)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Previous
                  </Link>
                ) : (
                  <span aria-disabled="true" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-400 cursor-not-allowed">
                    Previous
                  </span>
                )}
                <span className="text-sm text-slate-600">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    href={leaderboardHref(page + 1, limit)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Next
                  </Link>
                ) : (
                  <span aria-disabled="true" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-400 cursor-not-allowed">
                    Next
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

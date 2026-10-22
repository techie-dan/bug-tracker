import { Bar, SkeletonPage } from "@/components/ui/skeleton";

export default function LeaderboardLoading() {
  return (
    <SkeletonPage label="Loading leaderboard…">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Bar className="h-8 w-44" />
            <Bar className="h-4 w-96 max-w-full" />
          </div>
          <Bar className="h-5 w-16" />
        </div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Bar className="h-4 w-8" />
              <div className="h-8 w-8 rounded-full bg-slate-200" />
              <div className="min-w-0 flex-1 space-y-1">
                <Bar className="h-4 w-32" />
              </div>
              <Bar className="h-4 w-20" />
              <Bar className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}

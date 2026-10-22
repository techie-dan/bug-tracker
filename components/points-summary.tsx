import Link from "next/link";
import { pointsProgress, TARGET_POINTS } from "@/lib/points/rules";

function ProgressRow({
  label,
  value,
  target,
  percent,
}: {
  label: string;
  value: number;
  target: number;
  percent: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-600">
          {value} / {target}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(Math.max(value, 0), target)}
        className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"
      >
        <div className="h-full rounded-full bg-teal-600" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Points balance, solved tasks and progress toward the goal (#428). */
export function PointsSummary({ points, solvedTasks }: { points: number; solvedTasks: number }) {
  const progress = pointsProgress(points, solvedTasks);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="points-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="points-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Points
        </h2>
        <Link href="/leaderboard" className="text-sm font-medium text-teal-700 hover:underline">
          Leaderboard
        </Link>
      </div>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{points}</p>
      <p className="text-sm text-slate-600">
        {solvedTasks} solved task{solvedTasks === 1 ? "" : "s"}
        {progress.targetMet ? " · Goal reached" : ""}
      </p>
      <div className="mt-4">
        <ProgressRow label="Points" value={points} target={TARGET_POINTS} percent={progress.pointsPercent} />
      </div>
    </section>
  );
}

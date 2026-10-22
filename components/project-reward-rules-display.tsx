import { SOLVER_POINTS, REPORTER_POINTS, REVIEWER_POINTS } from "@/lib/points/rules";
import type { ProjectRewardConfig } from "@/lib/points/project-rewards";

interface ProjectRewardRulesDisplayProps {
  rewardConfig?: ProjectRewardConfig | null;
}

export function ProjectRewardRulesDisplay({
  rewardConfig,
}: ProjectRewardRulesDisplayProps) {
  const solver = rewardConfig?.solver ?? SOLVER_POINTS;
  const reporter = rewardConfig?.reporter ?? REPORTER_POINTS;
  const reviewer = rewardConfig?.reviewer ?? REVIEWER_POINTS;
  const guidelines = rewardConfig?.guidelines;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          Reward & Points Rules
        </h3>
        {rewardConfig ? (
          <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700 border border-teal-200">
            Custom Project Scheme
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            Standard Workspace Scheme
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
          <span className="text-xs text-slate-500">Low Severity</span>
          <p className="text-sm font-bold text-slate-900">{solver.low} pts</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
          <span className="text-xs text-slate-500">Medium Severity</span>
          <p className="text-sm font-bold text-slate-900">{solver.medium} pts</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
          <span className="text-xs text-slate-500">High Severity</span>
          <p className="text-sm font-bold text-slate-900">{solver.high} pts</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2.5 border border-slate-100">
          <span className="text-xs text-slate-500">Critical Severity</span>
          <p className="text-sm font-bold text-slate-900">{solver.critical} pts</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
          <span className="text-xs font-medium text-slate-600">Reporter Bounty</span>
          <span className="text-sm font-bold text-slate-900">{reporter} pts</span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
          <span className="text-xs font-medium text-slate-600">Reviewer Reward</span>
          <span className="text-sm font-bold text-slate-900">{reviewer} pts</span>
        </div>
      </div>

      {guidelines ? (
        <div className="mt-3 rounded-lg bg-teal-50/60 p-3 border border-teal-100">
          <p className="text-xs font-semibold text-teal-900">Earning Guidelines:</p>
          <p className="mt-1 text-xs text-teal-800 whitespace-pre-wrap">{guidelines}</p>
        </div>
      ) : null}
    </div>
  );
}

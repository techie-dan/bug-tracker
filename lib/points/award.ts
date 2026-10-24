import type { Prisma, PrismaClient, Severity } from "@prisma/client";
import { pointSourceKey, solverPoints, type PointRole } from "./rules";
import {
  calculateSolverPoints,
  getProjectRewardConfig,
  type ProjectRewardConfig,
} from "./project-rewards";

/**
 * Writes points to the ledger (#428). The backfill (#435), the merge gate
 * (#434) and validations (#433) call `award()`; they must not edit this file.
 *
 * Every award has a `sourceKey`, and `PointEntry.sourceKey` is unique, so the
 * same award written twice adds one row. A correction is a new row with
 * negative points (#436, #450); rows are never deleted.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export type PointAward = {
  tenantId: string;
  userId: string;
  bugId: string | null;
  role: PointRole;
  points: number;
  sourceKey: string;
};

/** Writes `entry` unless an entry with its `sourceKey` exists. True if it was written. */
export async function award(db: Db, entry: PointAward): Promise<boolean> {
  const { count } = await db.pointEntry.createMany({ data: [entry], skipDuplicates: true });
  return count > 0;
}

export type ResolvedIssue = {
  id: string;
  tenantId: string;
  projectId?: string | null;
  /** The severity stored on the issue at resolution time. */
  severity: Severity;
  /** Who it was assigned to at resolution time; nobody earns points without one. */
  assigneeId: string | null;
  rewardConfig?: ProjectRewardConfig | null;
};

/** The solver award for resolving `issue`, or null when nobody is assigned. */
export function solverAward(issue: ResolvedIssue): PointAward | null {
  if (!issue.assigneeId) return null;
  const points = issue.rewardConfig
    ? calculateSolverPoints(issue.severity, issue.rewardConfig)
    : solverPoints(issue.severity);

  return {
    tenantId: issue.tenantId,
    userId: issue.assigneeId,
    bugId: issue.id,
    role: "solver",
    points,
    sourceKey: pointSourceKey("solver", issue.id, issue.assigneeId),
  };
}

/** Awards solver points for a resolved issue, once per issue and person. */
export async function awardSolver(db: Db, issue: ResolvedIssue): Promise<boolean> {
  if (!issue.assigneeId) return false;

  let rewardConfig = issue.rewardConfig;
  if (rewardConfig === undefined) {
    let projectId = issue.projectId;
    if (!projectId && "bug" in db) {
      // Look up projectId from the issue row if not supplied
      const bug = await (db as PrismaClient).bug.findUnique({
        where: { id: issue.id },
        select: { projectId: true },
      });
      projectId = bug?.projectId;
    }
    if (projectId && "project" in db) {
      rewardConfig = await getProjectRewardConfig(db, projectId);
    }
  }

  const entry = solverAward({ ...issue, rewardConfig });
  return entry ? award(db, entry) : false;
}

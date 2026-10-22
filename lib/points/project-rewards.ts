import { z } from "zod";
import type { Prisma, PrismaClient, Severity } from "@prisma/client";
import {
  SOLVER_POINTS,
  REPORTER_POINTS,
  REVIEWER_POINTS,
} from "./rules";

export const projectRewardConfigSchema = z
  .object({
    solver: z
      .object({
        low: z.coerce.number().int().min(0).max(10000).default(SOLVER_POINTS.low),
        medium: z.coerce.number().int().min(0).max(10000).default(SOLVER_POINTS.medium),
        high: z.coerce.number().int().min(0).max(10000).default(SOLVER_POINTS.high),
        critical: z.coerce.number().int().min(0).max(10000).default(SOLVER_POINTS.critical),
      })
      .default({
        low: SOLVER_POINTS.low,
        medium: SOLVER_POINTS.medium,
        high: SOLVER_POINTS.high,
        critical: SOLVER_POINTS.critical,
      }),
    reporter: z.coerce.number().int().min(0).max(10000).default(REPORTER_POINTS),
    reviewer: z.coerce.number().int().min(0).max(10000).default(REVIEWER_POINTS),
    guidelines: z.string().trim().max(2000).optional().nullable().default(null),
  })
  .default({
    solver: {
      low: SOLVER_POINTS.low,
      medium: SOLVER_POINTS.medium,
      high: SOLVER_POINTS.high,
      critical: SOLVER_POINTS.critical,
    },
    reporter: REPORTER_POINTS,
    reviewer: REVIEWER_POINTS,
    guidelines: null,
  });

export type ProjectRewardConfig = z.infer<typeof projectRewardConfigSchema>;

export function parseProjectRewardConfig(raw: unknown): ProjectRewardConfig {
  if (!raw || typeof raw !== "object") {
    return projectRewardConfigSchema.parse({});
  }
  const result = projectRewardConfigSchema.safeParse(raw);
  if (!result.success) {
    return projectRewardConfigSchema.parse({});
  }
  return result.data;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Resolves the effective reward configuration for a project, falling back to
 * default standard values if no custom rewardConfig is defined.
 */
export async function getProjectRewardConfig(
  db: Db,
  projectId: string | null | undefined,
): Promise<ProjectRewardConfig> {
  if (!projectId || !db?.project?.findUnique) {
    return projectRewardConfigSchema.parse({});
  }
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { rewardConfig: true },
  });
  return parseProjectRewardConfig(project?.rewardConfig);
}

/**
 * Calculates solver points considering custom project configuration if present.
 */
export function calculateSolverPoints(
  severity: Severity,
  config?: ProjectRewardConfig | null,
): number {
  if (!config) {
    return SOLVER_POINTS[severity];
  }
  return config.solver[severity] ?? SOLVER_POINTS[severity];
}

/**
 * Calculates reporter points considering custom project configuration if present.
 */
export function calculateReporterPoints(config?: ProjectRewardConfig | null): number {
  if (!config) {
    return REPORTER_POINTS;
  }
  return config.reporter ?? REPORTER_POINTS;
}

/**
 * Calculates reviewer points considering custom project configuration if present.
 */
export function calculateReviewerPoints(config?: ProjectRewardConfig | null): number {
  if (!config) {
    return REVIEWER_POINTS;
  }
  return config.reviewer ?? REVIEWER_POINTS;
}

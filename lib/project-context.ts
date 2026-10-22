import { cookies } from "next/headers";
import type { Prisma, PrismaClient } from "@prisma/client";
import { ZEDU_SLUG } from "@/lib/tenant";
import { appCookieOptions } from "@/lib/cookie-options";

/**
 * The project the person is currently working in (#426).
 *
 * The choice lives in a cookie so it survives navigation, but it is only a
 * hint: every read validates it against the person's current tenant. A stale
 * or forged cookie falls back to the tenant's Zedu project, then its oldest.
 */

export const ACTIVE_PROJECT_COOKIE = "ziki_active_project";
export const ACTIVE_PROJECT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type Db = PrismaClient | Prisma.TransactionClient;

export type ProjectChoice = {
  id: string;
  name: string;
  slug: string;
};

export type ProjectContext = {
  projects: ProjectChoice[];
  activeProjectId: string | null;
};

/** A project in `projects`, preferring `requestedId`, then Zedu, then oldest. */
export function pickProjectId(
  projects: ReadonlyArray<Pick<ProjectChoice, "id" | "slug">>,
  requestedId?: string | null,
): string | null {
  if (requestedId) {
    const requested = projects.find((project) => project.id === requestedId);
    if (requested) return requested.id;
  }
  return (projects.find((project) => project.slug === ZEDU_SLUG) ?? projects[0])?.id ?? null;
}

export async function projectsForTenant(
  db: Db,
  tenantId: string,
): Promise<ProjectChoice[]> {
  try {
    return await db.project.findMany({
      where: { tenantId, archivedAt: null },
      select: { id: true, name: true, slug: true },
      orderBy: { createdAt: "asc" },
    });
  } catch (error) {
    console.error("[project-context] projectsForTenant failed", error);
    return [];
  }
}

async function activeProjectIdFromCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(ACTIVE_PROJECT_COOKIE)?.value ?? null;
  } catch {
    // Unit tests and non-request callers have no cookie jar; use the default.
    return null;
  }
}

/** The projects this tenant can switch between, and the active one. */
export async function projectContextFor(
  db: Db,
  tenantId: string | null,
): Promise<ProjectContext> {
  if (!tenantId) return { projects: [], activeProjectId: null };

  try {
    const projects = await projectsForTenant(db, tenantId);
    const requestedId = await activeProjectIdFromCookie();
    return { projects, activeProjectId: pickProjectId(projects, requestedId) };
  } catch (error) {
    console.error("[project-context] projectContextFor failed", error);
    return { projects: [], activeProjectId: null };
  }
}

/** The project new issues go into, and the list is filtered by. */
export async function activeProjectIdFor(
  db: Db,
  tenantId: string | null,
): Promise<string | null> {
  return (await projectContextFor(db, tenantId)).activeProjectId;
}

/** Remember the project on this device; server actions validate it first. */
export async function setActiveProjectCookie(projectId: string): Promise<void> {
  (await cookies()).set(ACTIVE_PROJECT_COOKIE, projectId, appCookieOptions(ACTIVE_PROJECT_COOKIE_MAX_AGE));
}

import type { Prisma, PrismaClient, Role } from "@prisma/client";
import { logger } from "@/lib/logger";

/** Why a role change was refused, or null when it is allowed. */
export type RoleChangeRefusal =
  | "self"
  | "not-found"
  | "super-admin"
  | "already-admin"
  | "already-user"
  | null;

/**
 * Guards for the role changes a super admin can make.
 *
 * Promotion and demotion share the same hazards: a super admin must not be
 * able to edit their own role, and must not be able to edit another super
 * admin — otherwise the last super admin can be stripped and nobody can
 * restore access. Kept pure so both server actions and Vitest can use it.
 */
export function refuseRoleChange(
  actorId: string,
  target: { id: string; role: Role } | null,
  nextRole: Role,
): RoleChangeRefusal {
  if (!target) return "not-found";
  if (target.id === actorId) return "self";
  if (target.role === "super_admin") return "super-admin";
  if (nextRole === "admin" && target.role === "admin") return "already-admin";
  if (nextRole === "user" && target.role === "user") return "already-user";
  return null;
}

export const ROLE_CHANGE_ERRORS: Record<
  Exclude<RoleChangeRefusal, null>,
  string
> = {
  self: "You cannot change your own role here",
  "not-found": "User not found",
  "super-admin": "Cannot change a super admin's role",
  "already-admin": "User is already an admin",
  "already-user": "User is already a regular user",
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Changes a user's site-wide role (escalation or demotion).
 * Bumps User.sessionVersion to invalidate any existing JWT sessions (#655).
 * Logs an audit message for the privilege change.
 */
export async function changeUserRole(
  db: Db,
  actor: { id: string; role: Role },
  input: { targetUserId: string; nextRole: Role },
): Promise<
  | { ok: true; user: { id: string; role: Role; sessionVersion: number } }
  | { ok: false; error: string }
> {
  const target = await db.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true, role: true, email: true, sessionVersion: true },
  });
  const refusal = refuseRoleChange(actor.id, target, input.nextRole);
  if (refusal) {
    return { ok: false, error: ROLE_CHANGE_ERRORS[refusal] };
  }
  const updated = await db.user.update({
    where: { id: target!.id },
    data: {
      role: input.nextRole,
      sessionVersion: { increment: 1 },
    },
    select: { id: true, role: true, sessionVersion: true },
  });
  logger.info("[auth] privilege change: user role updated", {
    actorId: actor.id,
    targetUserId: target!.id,
    fromRole: target!.role,
    toRole: input.nextRole,
    newSessionVersion: updated.sessionVersion,
  });
  return { ok: true, user: updated };
}
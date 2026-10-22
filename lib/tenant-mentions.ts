import type { Prisma } from "@prisma/client";
import { extractMentionedUserIds, normalizeMentions } from "@/lib/mentions";

/**
 * #502: an @mention only means something inside the issue's own tenant.
 * Resolving tags against every account on the site let anyone notify (and
 * email the issue title to) people in other tenants.
 */

/** Users who belong to `tenantId`: the only people a mention may resolve to. */
export function tenantMemberWhere(tenantId: string): Prisma.UserWhereInput {
  return { memberships: { some: { tenantId } } };
}

type UserReader = Pick<Prisma.TransactionClient, "user">;

/**
 * Canonicalise `@[Name](userId)` tags against the tenant's members. Members
 * get their current name; anyone else (unknown, or in another tenant)
 * degrades to plain `@Name`, so they are never notified.
 */
export async function resolveTenantMentions(
  db: UserReader,
  tenantId: string,
  text: string,
): Promise<string> {
  const ids = extractMentionedUserIds(text);
  if (ids.length === 0) return text;
  const members = await db.user.findMany({
    where: { id: { in: ids }, ...tenantMemberWhere(tenantId) },
    select: { id: true, name: true },
  });
  return normalizeMentions(text, new Map(members.map((user) => [user.id, user.name])));
}

import type { Prisma } from "@prisma/client";
import { boundSearchTerm, escapeSearchQuery } from "@/lib/search";

/**
 * Builds Prisma `where` filter for searching users by name or email.
 * Safely escapes SQL LIKE wildcards (%, _) and backslashes.
 */
export function buildUserSearchWhere(
  query?: string | string[] | null,
): Prisma.UserWhereInput {
  const raw = Array.isArray(query) ? (query.length > 0 ? query[0] : undefined) : query;
  const trimmed = raw == null ? undefined : boundSearchTerm(raw);
  if (!trimmed) {
    return {};
  }

  const escaped = escapeSearchQuery(trimmed);

  return {
    OR: [
      { name: { contains: escaped, mode: "insensitive" } },
      { email: { contains: escaped, mode: "insensitive" } },
    ],
  };
}

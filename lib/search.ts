/**
 * Escapes SQL LIKE / ILIKE wildcard characters (%, _) and the escape character (\)
 * so that user input passed into Prisma `contains` filter is treated as literal text.
 *
 * The escaping is load-bearing, not cosmetic. Prisma compiles `contains` to
 * `ILIKE '%' || $1 || '%'` (or `ILIKE CONCAT('%', $1, '%')`) and binds the
 * search term as a parameter *without* escaping it. Binding protects against
 * SQL injection, but it does not stop PostgreSQL reading `%` and `_` inside the
 * pattern as wildcards. So a search for `%` would match every issue, and a
 * search for `test_case` would also match `testXcase`.
 *
 * Backslash is PostgreSQL's default LIKE escape character, so escaping the
 * wildcards (and the backslash itself, which is doubled to stay a literal one)
 * is what makes the match literal. It also keeps the database in step with
 * `lib/search-snippet.ts`, which highlights the same terms literally.
 */
/** Longest search term any list or picker will use; the rest is dropped. */
export const MAX_SEARCH_LENGTH = 200;

/**
 * Trims a search term and cuts it to MAX_SEARCH_LENGTH, before escaping. An
 * unbounded term becomes an unbounded ILIKE pattern, which anyone signed in
 * could use to make the database do work for nothing.
 */
export function boundSearchTerm(raw: string): string {
  return raw.trim().slice(0, MAX_SEARCH_LENGTH);
}

export function escapeSearchQuery(query: string): string {
  return query.replace(/[\\%_]/g, "\\$&");
}

/**
 * Normalizes a query parameter value that may be a single string or an array of strings (repeated keys)
 * to a single string value (taking the first occurrence).
 */
export function toSingleQueryParam(
  value: string | string[] | undefined | null,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value ?? undefined;
}


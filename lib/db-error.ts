/**
 * A sentence a person can read when Postgres is behind the code.
 * The raw Prisma error includes the query; this keeps the missing column or
 * table and leaves the rest in the server log.
 */
export function databaseErrorReason(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  const code =
    error !== null && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  const meta =
    error !== null &&
    typeof error === "object" &&
    "meta" in error &&
    typeof (error as { meta?: unknown }).meta === "object" &&
    (error as { meta?: unknown }).meta !== null
      ? ((error as { meta: { column?: unknown; table?: unknown } }).meta ?? {})
      : {};
  const named = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

  if (code === "P2022" || /column [`'"]?[\w."]+[`'"]? does not exist/i.test(message)) {
    const column =
      named(meta.column) ?? message.match(/column [`'"]?([\w."]+)[`'"]? does not exist/i)?.[1] ?? "a column";
    return `The database is missing the ${column} column, so this page could not finish loading.`;
  }

  if (code === "P2021" || /(?:table|relation) [`'"]?[\w."]+[`'"]? does not exist/i.test(message)) {
    const table =
      named(meta.table) ??
      message.match(/(?:table|relation) [`'"]?([\w."]+)[`'"]? does not exist/i)?.[1] ??
      "a table";
    return `The database is missing the ${table} table, so this page could not finish loading.`;
  }

  const required = message.match(/Field (\w+) is required to return data/i);
  if (required) {
    return `A linked ${required[1]} record is missing, so this page could not finish loading.`;
  }

  return null;
}

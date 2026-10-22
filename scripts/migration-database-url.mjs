/**
 * Connection string Prisma Migrate should use.
 *
 * `migrate deploy` takes a session advisory lock. A Neon or PgBouncer
 * transaction pooler does not keep that lock, so deploy times out (P1002)
 * and the new container never passes its healthcheck. Migrate through a
 * direct host. The app process keeps the pooled DATABASE_URL.
 *
 * DIRECT_URL wins when it is set. Otherwise a Neon `-pooler` host is
 * rewritten to the direct host. Anything else is left unchanged.
 */
export function migrationDatabaseUrl(databaseUrl, directUrl) {
  const direct = unquote(directUrl);
  if (direct) return direct;

  const url = unquote(databaseUrl);
  if (!url) return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (!parsed.hostname.includes("-pooler")) return url;
  parsed.hostname = parsed.hostname.replace("-pooler", "");
  return parsed.toString();
}

export function databaseHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "unparsed";
  }
}

function unquote(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

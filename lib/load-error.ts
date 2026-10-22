import { randomUUID } from "node:crypto";

/**
 * Logs a page query that failed and returns a short reference to show in its
 * place. The error itself stays in the server log: database messages name
 * tables, columns and constraints, which a person reading the page has no use
 * for and shouldn't see. The reference ties what they report to the log line.
 */
export function logLoadFailure(label: string, error: unknown): string {
  const reference = randomUUID().slice(0, 8);
  console.error(`${label} (ref ${reference})`, error);
  return reference;
}

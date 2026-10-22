import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Raw SQL must stay parameterized (#660). Prisma's tagged-template raw calls
 * (prisma.$queryRaw`... ${value}`) bind every `${}` as a parameter. These
 * guards fail if anyone reaches for an API that pastes text into SQL.
 */
const ROOTS = ["app", "lib", "components", "scripts", "prisma"];
const SKIP_DIRS = new Set(["node_modules", ".next", "migrations"]);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.[tj]sx?$/.test(name)) found.push(full);
  }
  return found;
}

const files = ROOTS.flatMap((root) => sourceFiles(root));
// Comments may mention `$queryRaw (`; only code counts.
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const sources = files.map((file) => [file, withoutComments(readFileSync(file, "utf8"))] as const);

function offenders(pattern: RegExp): string[] {
  return sources
    .filter(([, text]) => pattern.test(text))
    .map(([file]) => file);
}

describe("raw SQL stays parameterized (#660)", () => {
  it("scans real source files", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(sources.some(([, text]) => text.includes("$queryRaw`"))).toBe(true);
  });

  it("never uses the Unsafe raw APIs, which run a string as SQL", () => {
    expect(offenders(/\$(query|execute)RawUnsafe/)).toEqual([]);
  });

  it("never builds SQL with Prisma.raw, which inserts text unescaped", () => {
    expect(offenders(/Prisma\.raw\s*\(/)).toEqual([]);
  });

  it("only calls $queryRaw and $executeRaw as tagged templates, never as functions", () => {
    expect(offenders(/\$(query|execute)Raw\s*(<[^>]*>)?\s*\(/)).toEqual([]);
  });

  it("never concatenates into a raw SQL template with +", () => {
    expect(offenders(/\$(query|execute)Raw(<[^`]*>)?`[^`]*`\s*\+/)).toEqual([]);
  });
});

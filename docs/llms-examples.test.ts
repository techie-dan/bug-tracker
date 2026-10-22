import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { agentQuestionSchema } from "@/lib/agent-questions";
import { redesignSchema } from "@/lib/redesigns";
import { commentSchema, statusSchema } from "@/lib/validations/issue";
import { bidSchema } from "@/lib/agent-api/bid";
import { extendSchema } from "@/lib/agent-api/deadline";
import { createSchema } from "@/lib/agent-api/issues";
import { testVerdictBodySchema } from "@/lib/agent-api/test-verdict";
import { validationBodySchema } from "@/lib/agent-api/validation";

/**
 * The request bodies in llms.txt must be ones the routes accept (#555).
 * Each documented example is parsed with the same zod schema the route uses.
 */
const doc = readFileSync("docs/ziki-for-agents.md", "utf8");

/** The text of one `### METHOD /path` section of the reference. */
function section(heading: string): string {
  const start = doc.indexOf(`\n### ${heading}\n`);
  expect(start, `missing section "${heading}"`).toBeGreaterThan(-1);
  const rest = doc.slice(start + 1);
  const next = rest.slice(4).search(/\n(### |## )/);
  return next === -1 ? rest : rest.slice(0, next + 4);
}

/** The JSON block that follows **Request Body:** (or **Request:**) in a section, without `// comments`. */
function requestBody(heading: string): unknown {
  const text = section(heading);
  const marker = Math.max(text.indexOf("**Request Body:**"), text.indexOf("**Request:**"));
  expect(marker, `"${heading}" has no Request Body`).toBeGreaterThan(-1);
  const block = /```json\n([\s\S]*?)```/.exec(text.slice(marker));
  expect(block, `"${heading}" has no JSON example`).not.toBeNull();
  return JSON.parse(block![1].replace(/\s\/\/[^\n]*/g, ""));
}

const EXAMPLES: Array<[string, z.ZodType]> = [
  ["POST /api/v1/issues", createSchema],
  ["POST /api/v1/issues/{id}/comments", commentSchema],
  ["POST /api/v1/issues/{id}/bid", bidSchema],
  ["POST /api/v1/issues/{id}/extend", extendSchema],
  ["POST /api/v1/issues/{id}/validations", validationBodySchema],
  ["POST /api/v1/issues/{id}/test-results", testVerdictBodySchema],
  ["POST /api/v1/questions", agentQuestionSchema],
  ["POST /api/v1/redesigns", redesignSchema],
];

describe("llms.txt request examples are accepted by the routes (#555)", () => {
  it.each(EXAMPLES)("%s", (heading, schema) => {
    const result = schema.safeParse(requestBody(heading));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("sends the idempotency key as a header on create, never in the body", () => {
    const create = section("POST /api/v1/issues");
    expect(create).toContain("`Idempotency-Key:");
    expect(requestBody("POST /api/v1/issues")).not.toHaveProperty("idempotencyKey");
    expect(createSchema.safeParse({ title: "A title", description: "A long enough description", idempotencyKey: "k" }).success).toBe(false);
  });

  it("documents the validation fields the route requires", () => {
    const validations = section("POST /api/v1/issues/{id}/validations");
    for (const needle of ["`kind`", "`real`", "`format`", "`duplicate`", "`fix`", "`severity`"]) {
      expect(validations).toContain(needle);
    }
    expect(requestBody("POST /api/v1/issues/{id}/validations")).toMatchObject({ kind: "real" });
  });

  it("documents the merge route without a body it never reads", () => {
    const merge = section("POST /api/v1/issues/{id}/merge");
    expect(merge).not.toContain("**Request Body:**");
    expect(merge).not.toContain("idempotencyKey");
  });

  it("lists only status values the routes accept", () => {
    const filter = /- `status` \(optional\): ([^\n]+)/.exec(section("GET /api/v1/issues"));
    expect(filter).not.toBeNull();
    const documented = [...filter![1].matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    expect(documented.length).toBeGreaterThan(0);
    for (const value of documented) expect(statusSchema.safeParse(value).success, value).toBe(true);
  });

  it("uses test-result and redesign field names the routes accept", () => {
    const results = section("POST /api/v1/issues/{id}/test-results");
    expect(results).toContain("goodToMerge");
    expect(results).not.toMatch(/"passed"|"artifacts"/);
  });
});

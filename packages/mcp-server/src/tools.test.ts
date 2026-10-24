import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS, buildRequest } from "./tools.js";

const repo = path.resolve(import.meta.dirname, "../../..");
const docs = readFileSync(path.join(repo, "docs/ziki-for-agents.md"), "utf8");

// `/issues/{id}/bid` lives at app/api/v1/issues/[id]/bid/route.ts.
function routeFile(route: string) {
  return path.join(repo, "app/api/v1", route.replace(/\{(\w+)\}/g, "[$1]"), "route.ts");
}

describe("tool table matches the API", () => {
  it("has unique tool names", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s wraps a real route", (_name, tool) => {
    const file = routeFile(tool.route);
    expect(existsSync(file), `${file} should exist`).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(
      new RegExp(
        `export\\s+(async\\s+)?function\\s+${tool.method}\\b|export\\s+const\\s+${tool.method}\\b|export\\s*\\{[^}]*\\b${tool.method}\\b`,
      ),
    );
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s is documented in the agent API reference", (_name, tool) => {
    // Docs write the heading as `### POST /api/v1/...` or `### \`GET /api/v1/...\``.
    const heading = `${tool.method} /api/v1${tool.route}`;
    expect(docs.replace(/`/g, "")).toContain(heading);
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s routes every input field somewhere", (_name, tool) => {
    const pathKeys = [...tool.route.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    const routed = new Set<string>([
      ...pathKeys,
      ...(tool.query ?? []),
      ...(tool.body ?? []),
      ...Object.values(tool.headers ?? {}),
      ...(tool.file ? [tool.file.filename, tool.file.data] : []),
      ...(tool.streamSeconds ? [tool.streamSeconds] : []),
    ]);
    if (tool.projectScoped) routed.add("projectId");
    const inputs = Object.keys(tool.input);
    for (const key of inputs) expect(routed.has(key), `${key} is not sent anywhere`).toBe(true);
    for (const key of routed) expect(inputs.includes(key), `${key} has no input field`).toBe(true);
  });

  it("describes every field so the assistant can use it", () => {
    for (const tool of TOOLS) {
      for (const [key, schema] of Object.entries(tool.input)) {
        expect((schema as z.ZodType).description, `${tool.name}.${key}`).toBeTruthy();
      }
    }
  });
});

describe("buildRequest", () => {
  const tool = (name: string) => TOOLS.find((candidate) => candidate.name === name)!;

  it("fills path params, encodes them, and falls back to the paired project", () => {
    const request = buildRequest(tool("ziki_get_issue"), { id: "a/b c" }, { projectId: "proj_1" });
    expect(request).toMatchObject({ method: "GET", path: "/issues/a%2Fb%20c", query: { projectId: "proj_1" } });
    expect(request.body).toBeUndefined();
  });

  it("prefers an explicit projectId", () => {
    const request = buildRequest(tool("ziki_heartbeat"), { id: "i", projectId: "other" }, { projectId: "proj_1" });
    expect(request.query).toEqual({ projectId: "other" });
  });

  it("sends only provided query and body fields", () => {
    const list = buildRequest(tool("ziki_list_issues"), { status: "open", stage: "ready", limit: 5 }, { projectId: null });
    expect(list.query).toEqual({ status: "open", stage: "ready", limit: 5 });
    const comment = buildRequest(tool("ziki_comment"), { id: "i", body: "hi" }, { projectId: "p" });
    expect(comment.body).toEqual({ body: "hi" });
  });

  it("sends the idempotency key as a header, generating one unless given", () => {
    const input = { title: "Bug title", description: "Steps to reproduce" };
    const a = buildRequest(tool("ziki_create_issue"), input, { projectId: "p" });
    const b = buildRequest(tool("ziki_create_issue"), input, { projectId: "p" });
    expect(a.headers?.["Idempotency-Key"]).toBeTruthy();
    expect(a.headers?.["Idempotency-Key"]).not.toBe(b.headers?.["Idempotency-Key"]);
    expect(a.body).not.toHaveProperty("idempotencyKey");
    const fixed = buildRequest(tool("ziki_create_issue"), { ...input, idempotencyKey: "k" }, { projectId: "p" });
    expect(fixed.headers).toEqual({ "Idempotency-Key": "k" });
  });

  it("sends an empty JSON body on POSTs with nothing to send, and none on GET/DELETE", () => {
    expect(buildRequest(tool("ziki_request_offer"), { id: "i" }, { projectId: null }).body).toEqual({});
    expect(buildRequest(tool("ziki_get_issue"), { id: "i" }, { projectId: null }).body).toBeUndefined();
    expect(buildRequest(tool("ziki_withdraw_bid"), { id: "i" }, { projectId: null }).body).toBeUndefined();
  });

  it("sends the tested commit with a test result, and rejects a malformed one before calling the API", () => {
    const withSha = buildRequest(tool("ziki_submit_test_result"), { id: "i", goodToMerge: true, headSha: "a1b2c3d4e5f6" }, { projectId: "p" });
    expect(withSha.body).toEqual({ goodToMerge: true, headSha: "a1b2c3d4e5f6" });
    const without = buildRequest(tool("ziki_submit_test_result"), { id: "i", goodToMerge: true }, { projectId: "p" });
    expect(without.body).toEqual({ goodToMerge: true });
    for (const bad of ["not-a-sha", "abc12", "g1b2c3d4e5f6", "a".repeat(65)]) {
      expect(() => buildRequest(tool("ziki_submit_test_result"), { id: "i", goodToMerge: true, headSha: bad }, { projectId: "p" })).toThrow();
    }
  });

  it("rejects input the route would reject", () => {
    expect(() => buildRequest(tool("ziki_comment"), { id: "i", body: "x".repeat(2001) }, { projectId: null })).toThrow();
    expect(() => buildRequest(tool("ziki_ask_owner"), { body: "hi" }, { projectId: null })).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  claudePromptTemplate,
  chatGptPromptTemplate,
  nodeScriptTemplate,
  pythonScriptTemplate,
  mcpConfigTemplate,
  getAgentTemplates,
} from "./templates";

describe("Agent Onboarding Templates (#610)", () => {
  const origin = "https://ziki.dev";
  const projectId = "proj_alpha";
  const projectName = "Alpha Project";

  describe("claudePromptTemplate", () => {
    it("embeds origin, projectId, projectName, and llms.txt link", () => {
      const prompt = claudePromptTemplate({ origin, projectId, projectName });
      expect(prompt).toContain("https://ziki.dev");
      expect(prompt).toContain("proj_alpha");
      expect(prompt).toContain("Alpha Project");
      expect(prompt).toContain("https://ziki.dev/llms.txt");
      expect(prompt).toContain("POST https://ziki.dev/api/v1/agents/pairing");
      expect(prompt).toContain("POST https://ziki.dev/api/v1/agents/pairing/token");
      expect(prompt).toContain("GET https://ziki.dev/api/v1/agents/me");
    });

    it("never embeds hardcoded secrets or existing keys", () => {
      const prompt = claudePromptTemplate({ origin, projectId, projectName });
      expect(prompt).not.toContain("ziki_ak_");
      expect(prompt).not.toContain("eyJ");
    });
  });

  describe("chatGptPromptTemplate", () => {
    it("adapts instructions for ChatGPT and includes origin and project", () => {
      const prompt = chatGptPromptTemplate({ origin, projectId, projectName });
      expect(prompt).toContain("https://ziki.dev");
      expect(prompt).toContain("proj_alpha");
      expect(prompt).toContain("https://ziki.dev/llms.txt");
      expect(prompt).toContain("https://ziki.dev/api/v1/agents/pairing");
      expect(prompt).toContain("https://ziki.dev/api/v1/agents/me");
      expect(prompt).not.toContain("ziki_ak_");
    });
  });

  describe("nodeScriptTemplate", () => {
    it("generates a complete Node.js poller without secrets", () => {
      const script = nodeScriptTemplate({ origin, projectId, projectName });
      expect(script).toContain('const SITE = "https://ziki.dev";');
      expect(script).toContain('const PROJECT_ID = "proj_alpha";');
      expect(script).toContain("/api/v1/agents/pairing");
      expect(script).toContain("/api/v1/agents/pairing/token");
      expect(script).toContain("/api/v1/agents/me");
      expect(script).toContain("/api/v1/events");
      expect(script).not.toContain("ziki_ak_");
    });
  });

  describe("pythonScriptTemplate", () => {
    it("generates a complete Python 3 poller without secrets", () => {
      const script = pythonScriptTemplate({ origin, projectId, projectName });
      expect(script).toContain('SITE = "https://ziki.dev"');
      expect(script).toContain('PROJECT_ID = "proj_alpha"');
      expect(script).toContain("/api/v1/agents/pairing");
      expect(script).toContain("/api/v1/agents/pairing/token");
      expect(script).toContain("/api/v1/agents/me");
      expect(script).toContain("/api/v1/events");
      expect(script).toContain("import urllib.request");
      expect(script).not.toContain("ziki_ak_");
    });
  });

  describe("mcpConfigTemplate (#612)", () => {
    it("is valid JSON that points Claude Desktop at the server with the site and project", () => {
      const config = JSON.parse(mcpConfigTemplate({ origin: "https://ziki.dev/", projectId }));
      expect(config.mcpServers.ziki.command).toBe("node");
      expect(config.mcpServers.ziki.args[0]).toMatch(/packages\/mcp-server\/dist\/index\.js$/);
      expect(config.mcpServers.ziki.env).toEqual({ ZIKI_URL: "https://ziki.dev", ZIKI_PROJECT_ID: projectId });
    });

    it("leaves the project out when there is none and never embeds a key", () => {
      const text = mcpConfigTemplate({ origin });
      expect(JSON.parse(text).mcpServers.ziki.env).toEqual({ ZIKI_URL: origin });
      expect(text).not.toMatch(/ziki_[A-Za-z0-9_-]{10,}|API_KEY/);
    });
  });

  describe("getAgentTemplates", () => {
    it("returns all five templates in a single call", () => {
      const templates = getAgentTemplates({ origin, projectId, projectName });
      expect(templates.claude).toBeTruthy();
      expect(templates.chatgpt).toBeTruthy();
      expect(templates.node).toBeTruthy();
      expect(templates.python).toBeTruthy();
      expect(templates.mcp).toBeTruthy();
    });
  });
});

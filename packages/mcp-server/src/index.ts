#!/usr/bin/env node
/**
 * ziki-mcp: an MCP server (stdio) that gives Claude and other assistants
 * Ziki as native tools. It reads the key the reference client saved with
 * `node scripts/ziki-agent.mjs pair`, so no key goes into the assistant's config.
 *
 *   ZIKI_URL            site to talk to (default https://ziki.dev)
 *   ZIKI_AGENT_CONFIG   pairing file (default ~/.config/ziki/agent.json)
 *   ZIKI_PROJECT_ID     project to use when a tool call omits projectId
 *
 * See docs/mcp-server.md.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ZikiClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main() {
  const config = await loadConfig();
  const server = createServer(new ZikiClient(config));
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol, so log to stderr only.
  console.error(`ziki-mcp connected to ${config.url}`);
}

main().catch((error) => {
  console.error(`ziki-mcp: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

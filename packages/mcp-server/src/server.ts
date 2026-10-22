import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZikiApiError, type ZikiClient } from "./client.js";
import { TOOLS, buildRequest, describeTool } from "./tools.js";

export const SERVER_NAME = "ziki";
export const SERVER_VERSION = "0.1.0";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

/** Build the MCP server with one tool per agent API route. */
export function createServer(client: ZikiClient): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: describeTool(tool), inputSchema: tool.input },
      async (input: Record<string, unknown>) => {
        try {
          const request = buildRequest(tool, input, { projectId: client.config.projectId });
          return text(await client.request(request));
        } catch (error) {
          // Tool errors go back to the assistant as results so it can react
          // (for example re-offer after a 410) instead of the call failing.
          const message =
            error instanceof ZikiApiError
              ? `${error.message}${error.body && typeof error.body === "object" ? `\n${JSON.stringify(error.body)}` : ""}`
              : error instanceof Error
                ? error.message
                : String(error);
          return { ...text(message), isError: true };
        }
      },
    );
  }

  return server;
}

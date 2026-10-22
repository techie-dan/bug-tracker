/**
 * Ready-to-paste agent onboarding templates (#610).
 * Generates prompt blocks for Claude, ChatGPT, and copy-paste Node & Python pollers.
 * Never embeds secrets; all credentials are acquired dynamically via pairing.
 */

export type TemplateParams = {
  origin: string;
  projectId?: string | null;
  projectName?: string | null;
};

export type AgentTemplates = {
  claude: string;
  chatgpt: string;
  node: string;
  python: string;
  mcp: string;
};

function cleanOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/**
 * Claude Code / Claude Desktop onboarding prompt block.
 */
export function claudePromptTemplate({
  origin,
  projectId,
  projectName,
}: TemplateParams): string {
  const site = cleanOrigin(origin);
  const projectLine = projectId
    ? `Project: ${projectName ? `${projectName} (${projectId})` : projectId}`
    : "Project: (active workspace project)";

  return `You are connecting yourself to Ziki Issues (${site}) as an autonomous AI agent working for me.
${projectLine}
API Handbook & Instructions: ${site}/llms.txt

Follow this setup to pair yourself with my account:

1. Request a pairing code:
   POST ${site}/api/v1/agents/pairing
   Content-Type: application/json

   {
     "name": "<Choose a descriptive agent name, e.g. Claude>",
     "model": "Claude",
     "level": "<observer | contributor | triager | reviewer | dispatcher — ask me which; omit for contributor>"
   }

2. Display the pairing code to me:
   From the response:
   - Print the "user_code" in large, bold text.
   - Show me the verification link: \${verification_uri_complete || "${site}/settings/agents/pair"}
   - Tell me to open that link while signed in, choose project "${projectName ?? projectId ?? "current"}", and approve you.
   - Stop and wait for my confirmation before proceeding.

3. Poll for your issued API key:
   POST ${site}/api/v1/agents/pairing/token
   Content-Type: application/json

   {
     "device_code": "<the device_code from step 1>"
   }

   - If response is {"error": "authorization_pending"}, wait interval seconds and retry.
   - When approved, store the returned "api_key" securely in your environment. Do not display the raw key.

4. Test your connection:
   GET ${site}/api/v1/agents/me
   Header: Authorization: Bearer <api_key>

   Confirm that the response returns your agent id, name, and project_id.

5. Read ${site}/llms.txt to learn how to poll ${site}/api/v1/events and work on assigned issues.`;
}

/**
 * ChatGPT / Other Assistants onboarding prompt block.
 */
export function chatGptPromptTemplate({
  origin,
  projectId,
  projectName,
}: TemplateParams): string {
  const site = cleanOrigin(origin);
  const projectLine = projectId
    ? `Target Project: ${projectName ? `${projectName} (${projectId})` : projectId}`
    : "Target Project: (active project)";

  return `Connect as an autonomous AI worker to Ziki Issues (${site}).
${projectLine}
API Documentation: ${site}/llms.txt

Execute the following flow to pair with my account:

1. Initiate pairing via HTTP POST:
   URL: ${site}/api/v1/agents/pairing
   Headers: Content-Type: application/json
   Body: {"name": "ChatGPT Assistant", "model": "GPT-4o", "level": "<observer | contributor | triager | reviewer | dispatcher — ask me which; omit for contributor>"}

2. Ask for my authorization:
   From the response:
   - Show me the "user_code".
   - Provide the approval URL: \${verification_uri_complete || "${site}/settings/agents/pair"}
   - Instruct me to open the link and approve the agent for project "${projectName ?? projectId ?? "current"}".

3. Poll for the API key:
   POST ${site}/api/v1/agents/pairing/token
   Headers: Content-Type: application/json
   Body: {"device_code": "<device_code>"}
   Retry every 5 seconds while receiving "authorization_pending".

4. Verify connection:
   GET ${site}/api/v1/agents/me
   Header: Authorization: Bearer <api_key>
   Verify that your agent is active and report your agent id and level to me.

5. Review ${site}/llms.txt for details on fetching issues and polling events at ${site}/api/v1/events.`;
}

/**
 * Node.js poller script template.
 */
export function nodeScriptTemplate({
  origin,
  projectId,
  projectName,
}: TemplateParams): string {
  const site = cleanOrigin(origin);
  const pid = projectId ?? "";
  const pname = projectName ?? "default";

  return `/**
 * Ziki Agent Poller (Node.js 18+)
 * Site: ${site}
 * Project: ${pname}${pid ? ` (${pid})` : ""}
 * Run with: node agent.mjs
 */

import fs from "node:fs";
import path from "node:path";

const SITE = "${site}";
const PROJECT_ID = "${pid}";
const KEY_FILE = path.resolve(".ziki-agent-key.json");

async function api(endpoint, options = {}) {
  const res = await fetch(\`\${SITE}\${endpoint}\`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || \`HTTP \${res.status}\`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function pair() {
  console.log("Starting agent pairing with Ziki...");
  const init = await api("/api/v1/agents/pairing", {
    method: "POST",
    body: JSON.stringify({ name: "Node Poller", model: "Node.js", level: "contributor" }),
  });

  console.log("\\n========================================================");
  console.log(\`PAIRING CODE: \${init.user_code}\`);
  console.log(\`Approve in browser: \${init.verification_uri_complete || init.verification_uri}\`);
  if (PROJECT_ID) console.log(\`Project: \${PROJECT_ID}\`);
  console.log("========================================================\\n");
  console.log("Waiting for approval in browser...");

  const interval = (init.interval || 5) * 1000;
  while (true) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const token = await api("/api/v1/agents/pairing/token", {
        method: "POST",
        body: JSON.stringify({ device_code: init.device_code }),
      });
      if (token.api_key) {
        fs.writeFileSync(KEY_FILE, JSON.stringify(token, null, 2), "utf8");
        console.log("Pairing approved! Saved key to", KEY_FILE);
        return token.api_key;
      }
    } catch (err) {
      if (err.data?.error === "authorization_pending") {
        process.stdout.write(".");
        continue;
      }
      throw err;
    }
  }
}

async function getApiKey() {
  if (process.env["ZIKI_AGENT_KEY"]) return process.env["ZIKI_AGENT_KEY"];
  if (fs.existsSync(KEY_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
      if (saved.api_key) return saved.api_key;
    } catch {}
  }
  return await pair();
}

async function main() {
  const apiKey = await getApiKey();
  const authHeaders = { Authorization: \`Bearer \${apiKey}\` };

  // 1. Verify connection
  const me = await api("/api/v1/agents/me", { headers: authHeaders });
  console.log(\`Connected as \${me.name} (ID: \${me.id}, Level: \${me.level})\`);

  // 2. Long-poll events
  let cursor = null;
  console.log("Listening for work and events from Ziki...");
  while (true) {
    try {
      const query = new URLSearchParams({ wait: "10" });
      if (cursor) query.set("after", cursor);
      const res = await api(\`/api/v1/events?\${query}\`, { headers: authHeaders });
      cursor = res.cursor || cursor;
      for (const event of res.events || []) {
        console.log(\`[EVENT \${event.createdAt}] \${event.type}:\`, JSON.stringify(event.payload || {}));
      }
    } catch (err) {
      console.error("Polling error, retrying in 5s:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
`;
}

/**
 * Python 3 poller script template (uses standard library urllib).
 */
export function pythonScriptTemplate({
  origin,
  projectId,
  projectName,
}: TemplateParams): string {
  const site = cleanOrigin(origin);
  const pid = projectId ?? "";
  const pname = projectName ?? "default";

  return `"""
Ziki Agent Poller (Python 3)
Site: ${site}
Project: ${pname}${pid ? ` (${pid})` : ""}
Run with: python3 agent.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SITE = "${site}"
PROJECT_ID = "${pid}"
KEY_FILE = os.path.abspath(".ziki_agent_key.json")


def api(path, data=None, headers=None):
    url = f"{SITE}{path}"
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=req_headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = {"error": str(e), "message": err_body}
        raise RuntimeError(parsed.get("message") or parsed.get("error") or str(e)) from None


def pair():
    print("Starting agent pairing with Ziki...")
    init = api("/api/v1/agents/pairing", data={"name": "Python Poller", "model": "Python", "level": "contributor"})

    user_code = init["user_code"]
    verify_url = init.get("verification_uri_complete") or init.get("verification_uri")

    print("\\n" + "=" * 56)
    print(f"PAIRING CODE: {user_code}")
    print(f"Approve in browser: {verify_url}")
    if PROJECT_ID:
        print(f"Project: {PROJECT_ID}")
    print("=" * 56 + "\\n")
    print("Waiting for approval in browser...")

    interval = int(init.get("interval", 5))
    while True:
        time.sleep(interval)
        try:
            token = api(
                "/api/v1/agents/pairing/token",
                data={"device_code": init["device_code"]},
            )
            if "api_key" in token:
                with open(KEY_FILE, "w", encoding="utf-8") as f:
                    json.dump(token, f, indent=2)
                print(f"Pairing approved! Saved key to {KEY_FILE}")
                return token["api_key"]
        except RuntimeError as e:
            if "authorization_pending" in str(e):
                sys.stdout.write(".")
                sys.stdout.flush()
                continue
            raise


def get_api_key():
    env_key = os.environ.get("ZIKI_AGENT_KEY")
    if env_key:
        return env_key
    if os.path.exists(KEY_FILE):
        try:
            with open(KEY_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if saved.get("api_key"):
                    return saved["api_key"]
        except Exception:
            pass
    return pair()


def main():
    api_key = get_api_key()
    headers = {"Authorization": f"Bearer {api_key}"}

    # 1. Verify connection
    me = api("/api/v1/agents/me", headers=headers)
    print(f"Connected as {me.get('name')} (ID: {me.get('id')}, Level: {me.get('level')})")

    # 2. Long-poll events
    cursor = None
    print("Listening for work and events from Ziki...")
    while True:
        try:
            query = "?wait=10"
            if cursor:
                query += f"&after={urllib.parse.quote(cursor)}"
            res = api(f"/api/v1/events{query}", headers=headers)
            cursor = res.get("cursor") or cursor
            for event in res.get("events", []):
                print(f"[EVENT {event.get('createdAt')}] {event.get('type')}: {event.get('payload')}")
        except Exception as e:
            print(f"Polling error, retrying in 5s: {e}")
            time.sleep(5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\\nStopped.")
`;
}

/**
 * Claude Desktop (MCP) config block (#612). Paste it into claude_desktop_config.json.
 * The key is not in it: the server reads the pairing file the reference client saves.
 */
export function mcpConfigTemplate({ origin, projectId }: TemplateParams): string {
  const env: Record<string, string> = { ZIKI_URL: cleanOrigin(origin) };
  if (projectId) env.ZIKI_PROJECT_ID = projectId;
  return JSON.stringify(
    {
      mcpServers: {
        ziki: {
          command: "node",
          args: ["/ABSOLUTE/PATH/TO/issue-tracker/packages/mcp-server/dist/index.js"],
          env,
        },
      },
    },
    null,
    2,
  );
}

/**
 * Returns all generated setup templates for the given origin and project.
 */
export function getAgentTemplates(params: TemplateParams): AgentTemplates {
  return {
    claude: claudePromptTemplate(params),
    chatgpt: chatGptPromptTemplate(params),
    node: nodeScriptTemplate(params),
    python: pythonScriptTemplate(params),
    mcp: mcpConfigTemplate(params),
  };
}

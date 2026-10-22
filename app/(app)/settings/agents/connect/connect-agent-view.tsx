"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import type { AgentTemplates } from "@/lib/agents/templates";
import {
  checkAgentConnectionAction,
  type ConnectionStatusResult,
} from "./actions";

type TabId = "claude" | "chatgpt" | "script" | "mcp";
type ScriptLang = "node" | "python";

export function ConnectAgentView({
  templates,
  siteUrl,
  projectId,
  projectName,
  initialConnected = false,
  initialAgentName = null,
}: {
  templates: AgentTemplates;
  siteUrl: string;
  projectId: string | null;
  projectName: string | null;
  initialConnected?: boolean;
  initialAgentName?: string | null;
}) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("claude");
  const [scriptLang, setScriptLang] = useState<ScriptLang>("node");
  const [copied, setCopied] = useState(false);
  const [pageOpenedAt] = useState(() => new Date().toISOString());

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatusResult>(
    () =>
      initialConnected
        ? {
            connected: true,
            agent: initialAgentName ? { id: "", name: initialAgentName } : undefined,
          }
        : { connected: false },
  );
  const [isPending, startTransition] = useTransition();

  const currentSnippet =
    activeTab === "claude"
      ? templates.claude
      : activeTab === "chatgpt"
        ? templates.chatgpt
        : activeTab === "mcp"
          ? templates.mcp
          : scriptLang === "node"
            ? templates.node
            : templates.python;

  const currentFilename =
    activeTab === "claude" || activeTab === "chatgpt"
      ? "prompt"
      : activeTab === "mcp"
        ? "claude_desktop_config.json"
        : scriptLang === "node"
        ? "agent.mjs"
        : "agent.py";

  async function handleCopy() {
    const ok = await copyText(currentSnippet);
    if (!ok) {
      toast("Could not copy automatically. Please select and copy the text.", "error");
      return;
    }
    setCopied(true);
    toast("Snippet copied to clipboard!", "success");
    setTimeout(() => setCopied(false), 2000);
  }

  function handleTestConnection() {
    startTransition(async () => {
      const result = await checkAgentConnectionAction({
        projectId,
        since: pageOpenedAt,
      });
      setConnectionStatus(result);
      if (result.connected) {
        toast(
          `Connection verified! Agent "${result.agent?.name ?? "Agent"}" called /agents/me.`,
          "success",
        );
      } else {
        toast(result.message ?? "No agent call detected yet.", "info");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Project context header */}
      <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Active Project
          </span>
          <p className="text-sm font-medium text-slate-900">
            {projectName ? `${projectName}` : "Default project"}{" "}
            {projectId ? (
              <span className="font-mono text-xs text-slate-500">({projectId})</span>
            ) : null}
          </p>
        </div>
        <div className="text-xs text-slate-500">
          Target origin:{" "}
          <span className="font-mono font-medium text-slate-700">{siteUrl}</span>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <div className="border-b border-slate-200 bg-slate-50/70 px-4 pt-3 sm:px-6">
          <div
            role="tablist"
            aria-label="Agent connection methods"
            className="-mb-px flex space-x-6 overflow-x-auto text-sm font-medium"
          >
            <button
              role="tab"
              id="tab-claude"
              aria-controls="panel-claude"
              aria-selected={activeTab === "claude"}
              onClick={() => setActiveTab("claude")}
              type="button"
              className={`border-b-2 pb-3 transition-colors ${
                activeTab === "claude"
                  ? "border-teal-600 font-semibold text-teal-800"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              Claude Code / Desktop
            </button>
            <button
              role="tab"
              id="tab-chatgpt"
              aria-controls="panel-chatgpt"
              aria-selected={activeTab === "chatgpt"}
              onClick={() => setActiveTab("chatgpt")}
              type="button"
              className={`border-b-2 pb-3 transition-colors ${
                activeTab === "chatgpt"
                  ? "border-teal-600 font-semibold text-teal-800"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              ChatGPT / Other Assistants
            </button>
            <button
              role="tab"
              id="tab-script"
              aria-controls="panel-script"
              aria-selected={activeTab === "script"}
              onClick={() => setActiveTab("script")}
              type="button"
              className={`border-b-2 pb-3 transition-colors ${
                activeTab === "script"
                  ? "border-teal-600 font-semibold text-teal-800"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              Script (Node & Python)
            </button>
            <button
              role="tab"
              id="tab-mcp"
              aria-controls="panel-mcp"
              aria-selected={activeTab === "mcp"}
              onClick={() => setActiveTab("mcp")}
              type="button"
              className={`border-b-2 pb-3 transition-colors ${
                activeTab === "mcp"
                  ? "border-teal-600 font-semibold text-teal-800"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              Claude Desktop (MCP)
            </button>
          </div>
        </div>

        {/* Tab Content Panels */}
        <div className="p-4 sm:p-6 space-y-4">
          {activeTab === "claude" && (
            <div
              id="panel-claude"
              role="tabpanel"
              aria-labelledby="tab-claude"
              className="space-y-3"
            >
              <div className="text-sm text-slate-600">
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Copy the prompt block below.</li>
                  <li>Paste it into your Claude Code session or Claude Desktop prompt.</li>
                  <li>Claude will ask for an agent name, request a pairing code, and show you an approval link.</li>
                  <li>Open the approval link in your browser to approve the pairing.</li>
                  <li>Once Claude calls <code className="font-mono text-xs text-slate-800">/agents/me</code>, click <strong>Test connection</strong> below!</li>
                </ol>
              </div>
            </div>
          )}

          {activeTab === "chatgpt" && (
            <div
              id="panel-chatgpt"
              role="tabpanel"
              aria-labelledby="tab-chatgpt"
              className="space-y-3"
            >
              <div className="text-sm text-slate-600">
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Copy the prompt block below.</li>
                  <li>Paste it into ChatGPT or your assistant with web/curl access.</li>
                  <li>Follow the assistant&apos;s prompt to approve the pairing code.</li>
                  <li>Click <strong>Test connection</strong> below once your assistant has verified.</li>
                </ol>
              </div>
            </div>
          )}

          {activeTab === "script" && (
            <div
              id="panel-script"
              role="tabpanel"
              aria-labelledby="tab-script"
              className="space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-600">
                  Pick your language, save the file locally, and run it. The script pairs automatically, saves the key locally, and long-polls <code className="font-mono text-xs text-slate-800">/api/v1/events</code>.
                </div>
                {/* Language Switcher */}
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setScriptLang("node")}
                    className={`rounded-md px-2.5 py-1 transition ${
                      scriptLang === "node"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Node.js
                  </button>
                  <button
                    type="button"
                    onClick={() => setScriptLang("python")}
                    className={`rounded-md px-2.5 py-1 transition ${
                      scriptLang === "python"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Python 3
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "mcp" && (
            <div
              id="panel-mcp"
              role="tabpanel"
              aria-labelledby="tab-mcp"
              className="space-y-3"
            >
              <div className="text-sm text-slate-600">
                <ol className="list-decimal pl-5 space-y-1">
                  <li>
                    In a clone of this repo, pair once:{" "}
                    <code className="font-mono text-xs text-slate-800">node scripts/ziki-agent.mjs pair --url {siteUrl}</code>
                  </li>
                  <li>
                    Build the server:{" "}
                    <code className="font-mono text-xs text-slate-800">cd packages/mcp-server &amp;&amp; pnpm install &amp;&amp; pnpm build</code>
                  </li>
                  <li>
                    Paste the config below into{" "}
                    <code className="font-mono text-xs text-slate-800">claude_desktop_config.json</code>, replacing the path with where you cloned the repo.
                  </li>
                  <li>Restart Claude Desktop. Ziki&apos;s tools appear in the tools menu.</li>
                </ol>
                <p className="mt-2 text-xs text-slate-500">
                  The config holds no key. The server reads the one saved by <code className="font-mono">pair</code>.
                </p>
              </div>
            </div>
          )}

          {/* Snippet display with copy button */}
          <div className="relative group">
            <div className="absolute right-3 top-3 z-10">
              <Button
                type="button"
                variant="secondary"
                onClick={handleCopy}
                className="text-xs py-1 px-2.5 shadow-xs"
              >
                {copied ? "✓ Copied" : `Copy ${currentFilename}`}
              </Button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800 [scrollbar-width:thin]">
              {currentSnippet}
            </pre>
          </div>
        </div>
      </div>

      {/* Connection Verification Section */}
      <section
        className={`rounded-xl border p-4 sm:p-6 transition-colors shadow-xs ${
          connectionStatus.connected
            ? "border-emerald-300 bg-emerald-50/40"
            : "border-slate-200 bg-white"
        }`}
        aria-labelledby="test-connection-heading"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2
              id="test-connection-heading"
              className="text-base font-semibold text-slate-900"
            >
              Connection status
            </h2>
            <p className="text-sm text-slate-600">
              {connectionStatus.connected ? (
                <span className="font-medium text-emerald-800">
                  ✓ Connected: Agent &quot;{connectionStatus.agent?.name ?? "Agent"}&quot; successfully made contact with <code className="font-mono text-xs">/api/v1/agents/me</code>.
                </span>
              ) : (
                "After your agent connects and makes its verification call to /api/v1/agents/me, click to verify."
              )}
            </p>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isPending}
              data-testid="test-connection-btn"
              className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                connectionStatus.connected
                  ? "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600"
                  : "bg-teal-700 text-white hover:bg-teal-800 focus-visible:ring-teal-600"
              } disabled:opacity-50`}
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  Checking...
                </span>
              ) : connectionStatus.connected ? (
                "✓ Connected"
              ) : (
                "Test connection"
              )}
            </button>
          </div>
        </div>

        {/* Helpful navigation links */}
        <div className="mt-4 border-t border-slate-200/60 pt-3 flex flex-wrap gap-4 text-xs font-medium text-teal-700">
          <Link href="/settings/agents/pair" className="hover:underline">
            Approve a pending pairing code →
          </Link>
          <Link href="/settings/agents" className="hover:underline">
            Manage registered agents →
          </Link>
          <Link href="/settings/audit" className="hover:underline">
            View agent audit log →
          </Link>
        </div>
      </section>
    </div>
  );
}

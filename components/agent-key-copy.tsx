"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { copyText } from "@/lib/clipboard";
import { useToast } from "@/components/ui/toast";
import { agentAccessRequest, agentBootstrapMessage } from "@/lib/agents/bootstrap-message";

/** A live key's prefix. The header shows this, not the secret. */
export type AgentKeyHint = {
  prefix: string;
  projectName: string | null;
};

export type AgentKeyCopyButtonProps = {
  projectId?: string | null;
  projectName?: string | null;
  fullWidth?: boolean;
  /** Prefixes of live keys for the active project, including legacy tenant-wide keys. */
  keys?: AgentKeyHint[];
  /** The person's personal API key for this project, when one has been issued. */
  apiKey?: string | null;
  keyPrefix?: string | null;
  /** Icon sits in the header tool cluster. Inline is the wider control used in the menu. */
  variant?: "inline" | "icon";
  align?: "start" | "end";
};

export function AgentKeyCopyButton({
  projectId,
  projectName,
  fullWidth = false,
  keys = [],
  apiKey = null,
  keyPrefix = null,
  variant = "inline",
  align = "start",
}: AgentKeyCopyButtonProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!popoverOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  if (!projectId) return null;

  async function handleCopyKey(e?: React.MouseEvent) {
    e?.stopPropagation();
    const origin = typeof window !== "undefined" ? window.location.origin : "https://ziki.dev";
    const value = apiKey
      ? agentBootstrapMessage({ origin, apiKey, projectName })
      : projectId!;
    const ok = await copyText(value);
    if (ok) {
      toast(apiKey ? "Agent setup copied. Paste it into your agent." : "Agent project key copied to clipboard.");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast(apiKey ? "Couldn't copy the agent setup." : `Could not copy. Key: ${projectId}`, "error");
    }
  }

  async function handleCopySite(e?: React.MouseEvent) {
    e?.stopPropagation();
    const origin = typeof window !== "undefined" ? window.location.origin : "https://ziki.dev";
    const ok = await copyText(agentAccessRequest({ origin, projectName }));
    if (ok) toast("Site copied. The agent will open the approval page.");
    else toast("Couldn't copy the site.", "error");
  }

  async function handleCopyProjectId(e?: React.MouseEvent) {
    e?.stopPropagation();
    const ok = await copyText(projectId!);
    if (ok) toast("Project id copied.");
    else toast(`Could not copy. Key: ${projectId}`, "error");
  }

  async function handleCopyEndpoint(e?: React.MouseEvent) {
    e?.stopPropagation();
    const origin = typeof window !== "undefined" ? window.location.origin : "https://ziki.dev";
    const endpoint = `${origin}/api/v1/issues?projectId=${projectId}`;
    const ok = await copyText(endpoint);
    if (ok) {
      toast("Agent API endpoint URL copied.");
    } else {
      toast("Couldn't copy the API endpoint URL.", "error");
    }
  }

  const shown = keyPrefix || projectId;
  const shortKey = shown.length > 12 ? `${shown.slice(0, 10)}…` : shown;

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center ${fullWidth ? "w-full" : "shrink-0"}`}
    >
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setPopoverOpen((prev) => !prev)}
          aria-label="Agent key"
          aria-expanded={popoverOpen}
          aria-haspopup="dialog"
          title="Agent key"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <circle cx="8" cy="15" r="3.25" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.8 13.2 20 4m0 0h-3.2M20 4v3.2" />
          </svg>
        </button>
      ) : (
      <div
        className={`inline-flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 ${
          fullWidth ? "w-full justify-between" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => setPopoverOpen((prev) => !prev)}
          title="View Agent Key configuration details"
          aria-expanded={popoverOpen}
          className="inline-flex h-full items-center gap-1.5 rounded-l-lg px-2.5 text-xs text-slate-700 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          <span className="font-medium text-slate-700">Agent Key:</span>
          <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200">
            {shortKey}
          </span>
        </button>

        {/* 1-Click Copy Button */}
        <button
          type="button"
          onClick={handleCopyKey}
          title={apiKey ? "Copy your agent key and this site" : `Copy key to clipboard: ${projectId}`}
          aria-label="Copy key to agent"
          className="inline-flex h-full items-center border-l border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 rounded-r-lg transition"
        >
          {copied ? (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 text-[11px]">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Copied
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px]">
              <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </span>
          )}
        </button>
      </div>
      )}

      {popoverOpen ? (
        <div
          role="dialog"
          aria-label="Agent Key Information"
          className={`absolute top-full z-50 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white p-4 text-xs shadow-lg ring-1 ring-black/5 ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="font-semibold text-slate-900">Agent key</span>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              aria-label="Close"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          <div className="mt-3 space-y-3">
            {variant === "icon" ? (
              <button
                type="button"
                onClick={handleCopyKey}
                className="inline-flex h-8 w-full items-center justify-center rounded-lg bg-teal-700 text-xs font-medium text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              >
                {copied ? "Copied" : "Copy key to agent"}
              </button>
            ) : null}
            <div>
              <span className="text-slate-500 block text-[11px]">Active Project</span>
              <span className="font-medium text-slate-800">{projectName ?? "Current Project"}</span>
            </div>

            {apiKey ? (
              <p className="text-slate-600">
                Copy sends your API key and this site. The agent can start without you registering one.
              </p>
            ) : null}

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-slate-500 text-[11px]">Or share only this site</span>
                <button
                  type="button"
                  onClick={handleCopySite}
                  className="text-teal-700 hover:text-teal-900 font-medium hover:underline text-[11px]"
                >
                  Copy site
                </button>
              </div>
              <p className="text-slate-600">
                The agent opens the approval page in your browser. You approve it while signed in, and the key comes back to the agent.
              </p>
            </div>

            <div>
              <span className="text-slate-500 block text-[11px]">API key prefixes</span>
              {keys.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {keys.map((key) => (
                    <li key={`${key.prefix}-${key.projectName ?? "all"}`} className="font-mono text-[11px] text-slate-800">
                      {key.prefix}…{key.projectName ? ` · ${key.projectName}` : " · every project"}
                    </li>
                  ))}
                </ul>
              ) : apiKey ? (
                <p className="mt-1 text-slate-600">
                  Your personal key is ready. Copy sends it with this site, and the agent can start without you registering one.
                </p>
              ) : (
                <p className="mt-1 text-slate-600">
                  No live key for this project. Open the app again, or register one in settings. The full secret is shown only once.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-slate-500 text-[11px]">Project id (for API queries)</span>
                <button
                  type="button"
                  onClick={handleCopyProjectId}
                  className="text-teal-700 hover:text-teal-900 font-medium hover:underline text-[11px]"
                >
                  Copy id
                </button>
              </div>
              <code className="block rounded bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-800 select-all border border-slate-200 break-all">
                {projectId}
              </code>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-slate-500 text-[11px]">Issue Feed Endpoint</span>
                <button
                  type="button"
                  onClick={handleCopyEndpoint}
                  className="text-teal-700 hover:text-teal-900 font-medium hover:underline text-[11px]"
                >
                  Copy URL
                </button>
              </div>
              <code className="block rounded bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-700 border border-slate-200 break-all">
                /api/v1/issues?projectId={projectId}
              </code>
            </div>

            <div className="pt-2 border-t border-slate-100 flex flex-col gap-1.5 font-medium text-teal-700">
              <Link
                href="/settings/agents"
                onClick={() => setPopoverOpen(false)}
                className="hover:underline hover:text-teal-900 flex items-center justify-between"
              >
                <span>Manage Agent API Keys</span>
                <span>→</span>
              </Link>
              <Link
                href="/settings/agents/pair"
                onClick={() => setPopoverOpen(false)}
                className="hover:underline hover:text-teal-900 flex items-center justify-between"
              >
                <span>Pair an Agent via Code</span>
                <span>→</span>
              </Link>
              <Link
                href="/llms.txt"
                onClick={() => setPopoverOpen(false)}
                className="hover:underline hover:text-teal-900 flex items-center justify-between"
              >
                <span>Agent Spec (/llms.txt)</span>
                <span>→</span>
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

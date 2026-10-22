"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { agentBootstrapMessage } from "@/lib/agents/bootstrap-message";

/** One live key on the agents list. The secret is copied, not printed. */
export function AgentRowKey({
  apiKey,
  prefix,
  projectId,
  projectName,
}: {
  apiKey: string | null;
  prefix: string;
  projectId: string | null;
  projectName: string | null;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const where = projectName ? ` · ${projectName}` : projectId ? "" : " · every project";

  async function copy() {
    if (!apiKey) return;
    const origin = window.location.origin;
    const value = projectId
      ? agentBootstrapMessage({ origin, apiKey, projectName })
      : apiKey;
    const ok = await copyText(value);
    if (!ok) {
      toast("Couldn't copy the key.", "error");
      return;
    }
    toast(projectId ? "Agent setup copied. Paste it into that agent." : "Key copied.");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!apiKey) {
    return (
      <p className="text-xs text-slate-500">
        Key {prefix}…{where}. This one was issued before it could be copied again. Regenerate it and the new key stays on this row.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[11px] text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{prefix}…</span>
      <span className="text-xs text-slate-500">{projectName ?? (projectId ? "This project" : "Every project")}</span>
      <button
        type="button"
        onClick={copy}
        className="text-xs font-medium text-teal-700 hover:text-teal-900 hover:underline"
      >
        {copied ? "Copied" : "Copy key"}
      </button>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { pairAgentAction, type PairingActionResult } from "../actions";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import type { AgentLevel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AgentProjectChoice } from "../create-agent-form";

/**
 * Approve an agent that asked to join (#427). A link from the agent opens
 * straight on the confirm step. The agent then collects its own key.
 */
export function PairForm({
  initialCode,
  pending,
  unknownCode,
  projects,
  activeProjectId,
}: {
  initialCode: string;
  pending: { name: string; model: string | null; level: AgentLevel | null } | null;
  unknownCode: boolean;
  projects: AgentProjectChoice[];
  activeProjectId: string | null;
}) {
  const [code, setCode] = useState(initialCode);
  const [result, action, pendingAction] = useActionState<PairingActionResult | undefined, FormData>(
    pairAgentAction,
    undefined,
  );

  if (result?.ok && result.step === "done") {
    return (
      <div className="mt-4 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4" role="status">
        <p className="text-sm font-medium text-slate-900">
          {result.name} is approved.
        </p>
        <p className="text-sm text-slate-700">
          It is listed under Your agents now. It picks up its key on its next check, within a few seconds.
        </p>
        <Link href="/settings/agents" className="text-sm font-medium text-teal-700 hover:underline">
          See your agents
        </Link>
      </div>
    );
  }

  const confirm =
    result?.ok && result.step === "confirm"
      ? result
      : pending && !result?.ok
        ? { code: initialCode, name: pending.name, model: pending.model, level: pending.level ?? "contributor" }
        : null;
  const error = result && !result.ok ? result.error : unknownCode && !result
    ? "That code doesn't match a waiting agent. It may have expired; ask the agent for a new one."
    : null;

  if (confirm) {
    const projectDefault =
      activeProjectId && projects.some((project) => project.id === activeProjectId)
        ? activeProjectId
        : projects[0]?.id;
    return (
      <form action={action} className="mt-4 space-y-3 rounded-lg border border-slate-200 p-4">
        <input type="hidden" name="code" value={confirm.code} />
        <input type="hidden" name="intent" value="approve" />
        <p className="text-sm text-slate-800">
          Approve <span className="font-semibold">{confirm.name}</span>
          {confirm.model ? ` (${confirm.model})` : ""} as an agent working for you, at{" "}
          <span className="font-semibold">{AGENT_LEVEL_LABELS[confirm.level]}</span> level?
        </p>
        <p className="text-xs text-slate-600">
          Only approve an agent you asked to set itself up. It will act on Ziki in your name. Its key
          works only in the project you choose, and it is sent back to the agent.
        </p>
        {projects.length === 0 ? (
          <p className="text-sm text-red-700" role="alert">
            This workspace has no projects yet, so the agent can&apos;t be given a key.
          </p>
        ) : (
          <div className="space-y-1 sm:max-w-xs">
            <label htmlFor="pair-project" className="block text-sm font-medium text-slate-800">
              Project
            </label>
            <Select id="pair-project" name="projectId" defaultValue={projectDefault} required>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pendingAction || projects.length === 0}>
            {pendingAction ? "Approving…" : "Approve"}
          </Button>
          <Link
            href="/settings/agents"
            className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </Link>
        </div>
      </form>
    );
  }

  return (
    <form action={action} className="mt-4 space-y-3" noValidate>
      <label htmlFor="pair-code" className="block text-sm font-medium text-slate-800">
        Code from your agent
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="pair-code"
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="ABCD-2345"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono uppercase sm:max-w-xs"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "pair-error" : undefined}
          required
        />
        <Button type="submit" disabled={pendingAction}>
          {pendingAction ? "Checking…" : "Continue"}
        </Button>
      </div>
      {error ? (
        <p id="pair-error" className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

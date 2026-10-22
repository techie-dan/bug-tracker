"use client";

import { useActionState, useEffect, useState } from "react";
import { createAgentAction, type CreateAgentActionResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import { AGENT_LEVEL_LABELS, CREATION_LEVELS } from "@/lib/agents/levels";
import { AGENT_MODEL_MAX, AGENT_NAME_MAX } from "@/lib/agents/registry-limits";

export type AgentProjectChoice = { id: string; name: string };

/** Register an agent; its key is shown here once and never again (#427). */
export function CreateAgentForm({
  projects,
  activeProjectId = null,
}: {
  projects: AgentProjectChoice[];
  activeProjectId?: string | null;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [issued, setIssued] = useState<Extract<CreateAgentActionResult, { ok: true }> | null>(null);
  const [result, action, pending] = useActionState<CreateAgentActionResult | undefined, FormData>(
    async (previous, formData) => {
      const next = await createAgentAction(previous, formData);
      if (next.ok) {
        setIssued(next);
        setName("");
        setModel("");
      }
      return next;
    },
    undefined,
  );
  const error = result && !result.ok ? result : null;

  // Put the person on the key, so it's selected and ready to copy.
  useEffect(() => {
    if (issued) document.getElementById("new-agent-key")?.focus();
  }, [issued]);

  async function copy() {
    if (!issued) return;
    toast((await copyText(issued.rawKey)) ? "Key copied." : "Couldn't copy. Select the key and copy it.");
  }

  if (issued) {
    return (
      <div className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4" role="status">
        <p className="text-sm font-medium text-slate-900">
          {issued.name} is registered. Copy its key now. It stays on this page with the agent.
        </p>
        <label htmlFor="new-agent-key" className="sr-only">
          Agent key
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="new-agent-key"
            readOnly
            value={issued.rawKey}
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" onClick={copy}>
            Copy key
          </Button>
        </div>
        <p className="text-xs text-slate-600">
          The agent sends it as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. If
          it&apos;s lost, regenerate the key on this page. The current key stops working immediately.
        </p>
        <Button type="button" variant="secondary" onClick={() => setIssued(null)}>
          I&apos;ve saved it
        </Button>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <p className="mt-3 text-sm text-slate-600">
        This workspace has no projects yet, so a key can&apos;t be limited to one.
      </p>
    );
  }

  return (
    <form action={action} className="mt-4 space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="agent-name" className="block text-sm font-medium text-slate-800">
            Name
          </label>
          <Input
            id="agent-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada's Claude"
            maxLength={AGENT_NAME_MAX + 20}
            required
            aria-invalid={error?.field === "name" || undefined}
            aria-describedby={error ? "agent-form-error" : undefined}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="agent-model" className="block text-sm font-medium text-slate-800">
            Model <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <Input
            id="agent-model"
            name="model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Claude, GPT, …"
            maxLength={AGENT_MODEL_MAX + 20}
            aria-invalid={error?.field === "model" || undefined}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="agent-project" className="block text-sm font-medium text-slate-800">
            Project
          </label>
          <Select
            id="agent-project"
            name="projectId"
            defaultValue={
              activeProjectId && projects.some((project) => project.id === activeProjectId)
                ? activeProjectId
                : projects[0]?.id
            }
            required
            aria-invalid={error?.field === "projectId" || undefined}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <p className="text-xs text-slate-500">The key only works in this project.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="agent-level" className="block text-sm font-medium text-slate-800">
            Starting level
          </label>
          <Select id="agent-level" name="level" defaultValue="observer">
            {CREATION_LEVELS.map((level) => (
              <option key={level} value={level}>
                {AGENT_LEVEL_LABELS[level]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error ? (
        <p id="agent-form-error" className="text-sm text-red-700" role="alert">
          {error.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Registering…" : "Register agent"}
      </Button>
    </form>
  );
}

"use client";

import { useActionState, useState, useTransition, useCallback, useEffect, useRef } from "react";
import {
  createWebhookAction,
  type CreateWebhookResult,
  deleteWebhookAction,
  type DeleteWebhookResult,
  listWebhooksAction,
  type ListWebhooksResult,
  reEnableWebhookAction,
  type ReEnableWebhookResult,
  type WebhookSubscriptionRow,
} from "@/app/actions/webhooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { copyText } from "@/lib/clipboard";
import { RelativeTime } from "@/components/relative-time";
import { Badge } from "@/components/ui/badge";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";

function statusBadge(enabled: boolean) {
  return enabled ? (
    <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-100">Active</Badge>
  ) : (
    <Badge className="bg-red-50 text-red-700 border border-red-100">Disabled</Badge>
  );
}

export function WebhookManagement() {
  const toast = useToast();
  const confirm = useConfirm();

  const [subscriptions, setSubscriptions] = useState<WebhookSubscriptionRow[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  async function load() {
    try {
      const result: ListWebhooksResult = await listWebhooksAction();
      if (result.ok) {
        setSubscriptions(result.subscriptions);
        setAgents(result.agents);
        setListError(null);
      } else {
        setListError(result.error);
      }
    } catch {
      setListError("Couldn't load webhook subscriptions. Please try again.");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const [agentId, setAgentId] = useState("");
  const [url, setUrl] = useState("");
  const [openSecretModal, setOpenSecretModal] = useState(false);
  const [createdSecret, setCreatedSecret] = useState("");
  const createFormRef = useRef<HTMLFormElement | null>(null);

  // --- Create form ---
  const [createResult, createAction, createPending] = useActionState<
    CreateWebhookResult | undefined,
    FormData
  >(
    async (_previous, formData) => {
      const next = await createWebhookAction(_previous, formData);
      if (next.ok) {
        setCreatedSecret(next.secret);
        setOpenSecretModal(true);
        setUrl("");
        await load();
      }
      return next;
    },
    undefined,
  );
  const createError = createResult && !createResult.ok ? createResult : null;

  const createFieldErrors = useFieldErrors("create-webhook-form", createFormRef);
  if (createError) {
    createFieldErrors.show(createError);
  }

  async function copyCreatedSecret() {
    const ok = await copyText(createdSecret);
    toast(ok ? "Signing secret copied." : "Couldn't copy. Select the secret and copy it.");
  }

  // --- Re-enable ---
  const [, reEnableAction, reEnablePending] = useTransitionAction<
    ReEnableWebhookResult,
    string
  >(reEnableWebhookAction, async (result) => {
    if (result.ok) {
      toast("Webhook re-enabled.", "success");
      await load();
    } else {
      toast(result.error, "error");
    }
  });

  // --- Delete ---
  const [, deleteAction, deletePending] = useTransitionAction<
    DeleteWebhookResult,
    string
  >(deleteWebhookAction, async (result) => {
    if (result.ok) {
      toast("Webhook deleted.", "success");
      await load();
    } else {
      toast(result.error, "error");
    }
  });

  function handleReEnable(id: string) {
    void reEnableAction(id);
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: "Delete webhook subscription?",
      body: "This stops all future deliveries. It can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    void deleteAction(id);
  }

  if (listError) {
    return (
      <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
        <p>{listError}</p>
        <Button type="button" variant="secondary" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {subscriptions.length > 0 ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Subscriptions
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="pb-2 font-medium text-slate-600">Agent</th>
                    <th className="pb-2 font-medium text-slate-600">URL</th>
                    <th className="pb-2 font-medium text-slate-600">Status</th>
                    <th className="pb-2 font-medium text-slate-600">Failures</th>
                    <th className="pb-2 font-medium text-slate-600">Last delivery</th>
                    <th className="pb-2 font-medium text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subscriptions.map((sub) => (
                    <tr key={sub.id} className="group">
                      <td className="py-3">
                        <p className="font-medium text-slate-900">{sub.agent.name}</p>
                      </td>
                      <td className="py-3">
                        <a
                          href={sub.url}
                          className="text-teal-700 hover:underline break-all"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {sub.url}
                        </a>
                      </td>
                      <td className="py-3">{statusBadge(sub.enabled)}</td>
                      <td className="py-3">
                        {sub.failureCount > 0 ? (
                          <span className="font-medium text-red-700">
                            {sub.failureCount}
                          </span>
                        ) : (
                          <span className="text-slate-500">0</span>
                        )}
                      </td>
                      <td className="py-3">
                        {sub.lastDeliveredAt ? (
                          <RelativeTime date={sub.lastDeliveredAt} />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {!sub.enabled && (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => handleReEnable(sub.id)}
                              disabled={reEnablePending || deletePending}
                            >
                              Re-enable
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="danger-secondary"
                            onClick={() => handleDelete(sub.id)}
                            disabled={reEnablePending || deletePending}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-600">
            No webhook subscriptions yet. Create one below to start receiving
            agent events at your own HTTPS endpoint.
          </p>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Add webhook
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Pick one of your agents, enter its HTTPS webhook endpoint, and copy
          the signing secret it generates.
        </p>
        <form
          action={createAction}
          className="mt-4 space-y-3"
          noValidate
          id="create-webhook-form"
          ref={createFormRef}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="webhook-agent" className="block text-sm font-medium text-slate-800">
                Agent
              </label>
              <Select
                id="webhook-agent"
                name="agentId"
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                required
                aria-invalid={createFieldErrors.fieldErrors.agentId ? true : undefined}
                aria-describedby={
                  createFieldErrors.fieldErrors.agentId
                    ? "create-webhook-form-agentId-error"
                    : undefined
                }
              >
                <option value="">Select an agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
              <FieldError
                formId="create-webhook-form"
                field="agentId"
                errors={createFieldErrors.fieldErrors}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="webhook-url" className="block text-sm font-medium text-slate-800">
                HTTPS endpoint URL
              </label>
              <Input
                id="webhook-url"
                name="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/hooks/ziki"
                required
                maxLength={2048}
                aria-invalid={createFieldErrors.fieldErrors.url ? true : undefined}
                aria-describedby={
                  createFieldErrors.fieldErrors.url
                    ? "create-webhook-form-url-error"
                    : undefined
                }
              />
              <FieldError
                formId="create-webhook-form"
                field="url"
                errors={createFieldErrors.fieldErrors}
              />
            </div>
          </div>
          {createError ? (
            <p
              id="create-webhook-form-error"
              className="text-sm text-red-700"
              role="alert"
            >
              {createError.error}
            </p>
          ) : null}
          <Button type="submit" disabled={createPending || !agentId || !url}>
            {createPending ? "Creating…" : "Add webhook"}
          </Button>
        </form>
      </section>
      {openSecretModal && createdSecret ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="webhook-secret-title"
        >
          <button
            type="button"
            className="fixed inset-0 bg-black/40"
            onClick={() => setOpenSecretModal(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpenSecretModal(false);
            }}
          />
          <div className="relative bg-white rounded-2xl border border-slate-200 p-6 shadow-xl w-full max-w-md mx-4">
            <h2 id="webhook-secret-title" className="text-lg font-semibold text-slate-900 mb-1">
              Signing secret
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              Copy this now. It won&rsquo;t be shown again. Use it to verify
              <code className="font-mono text-xs">X-Ziki-Signature</code> headers.
            </p>
            <div className="space-y-2">
              <label htmlFor="webhook-secret" className="sr-only">
                Signing secret
              </label>
              <div className="flex gap-2">
                <Input
                  id="webhook-secret"
                  readOnly
                  value={createdSecret}
                  className="font-mono text-xs flex-1"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" onClick={copyCreatedSecret}>
                  Copy secret
                </Button>
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpenSecretModal(false);
                setCreatedSecret("");
              }}
              className="w-full"
            >
              I&rsquo;ve saved it
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function useTransitionAction<TResult, TId>(
  action: (id: TId) => Promise<TResult>,
  onDone: (result: TResult) => void | Promise<void>,
) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TResult | null>(null);

  const run = useCallback(
    (id: TId) => {
      startTransition(async () => {
        const next = await action(id);
        setResult(next);
        await onDone(next);
      });
    },
    [action, onDone],
  );

  return [result, run, pending] as const;
}

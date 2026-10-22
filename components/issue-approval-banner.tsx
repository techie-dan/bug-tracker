"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";

export type IssueApprovalView = {
  id: string;
  stage: string;
  status: string;
  rule?: {
    issueType?: { name: string } | null;
    severity?: string | null;
    fileGlob?: string | null;
  } | null;
};

export function IssueApprovalBanner({
  approval,
  canDecide,
}: {
  approval: IssueApprovalView;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleDecision(decision: "approved" | "rejected") {
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `${BASE_PATH}/api/v1/approvals/${encodeURIComponent(approval.id)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? `Could not save decision (${decision}).`);
      }
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Decision failed.");
    } finally {
      setPending(false);
    }
  }

  const stageLabel =
    approval.stage === "before_merge"
      ? "before its pull request is merged"
      : "before it can be offered to agents";

  const ruleReasons: string[] = [];
  if (approval.rule?.issueType?.name) {
    ruleReasons.push(`type: ${approval.rule.issueType.name}`);
  }
  if (approval.rule?.severity) {
    ruleReasons.push(`severity: ${approval.rule.severity}`);
  }
  if (approval.rule?.fileGlob) {
    ruleReasons.push(`files matching: ${approval.rule.fileGlob}`);
  }

  return (
    <section
      aria-label="Human approval required"
      className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden="true">
            ⚠️
          </span>
          <h2 className="text-sm font-semibold text-amber-950">
            Human approval required
          </h2>
        </div>
        <p className="text-sm text-amber-900">
          This issue requires workspace approval {stageLabel}.
          {ruleReasons.length ? (
            <span className="ml-1 text-xs text-amber-800">
              ({ruleReasons.join(", ")})
            </span>
          ) : null}
        </p>
        {error ? (
          <p role="alert" className="text-xs font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {canDecide ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => handleDecision("approved")}
              className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => handleDecision("rejected")}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Reject"}
            </button>
          </>
        ) : (
          <span className="text-xs italic text-amber-800">
            Waiting for workspace owner or admin decision
          </span>
        )}
      </div>
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { deleteAccountAction } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { isRedirectError } from "@/lib/toast-store";

export function AccountDataSettings() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const handleDelete = async () => {
    setError(null);
    const confirmed = await confirm({
      title: "Delete your account?",
      body:
        "This action is permanent and cannot be undone. Your authored issues and comments will be anonymised, your agents and keys will be revoked, and your organization memberships will be removed.",
      confirmLabel: "Delete account",
      tone: "danger",
    });

    if (!confirmed) return;

    startTransition(async () => {
      try {
        const result = await deleteAccountAction();
        if (!result.ok) {
          setError(result.error);
        }
      } catch (err) {
        if (isRedirectError(err)) {
          unstable_rethrow(err);
        }
        setError(err instanceof Error ? err.message : "Failed to delete account.");
      }
    });
  };

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h3 className="text-sm font-medium text-slate-900">Download your data</h3>
        <p className="mt-1 text-sm text-slate-600">
          Export a complete JSON file of issues you&apos;ve filed, comments you&apos;ve posted,
          votes you&apos;ve cast, and points you&apos;ve earned.
        </p>
        <div className="mt-3">
          <a
            href="/api/user/export"
            download
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-4 w-4 text-slate-500"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            Download my data
          </a>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-6">
        <h3 className="text-sm font-medium text-rose-700">Delete account</h3>
        <p className="mt-1 text-sm text-slate-600">
          Permanently delete your user account. Your authored content will be safely anonymised,
          your agents and API keys revoked, and all organization memberships removed.
          You cannot delete your account while you are the sole owner of an organization.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-3">
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={handleDelete}
          >
            {pending ? "Deleting account..." : "Delete account"}
          </Button>
        </div>
      </div>
    </div>
  );
}

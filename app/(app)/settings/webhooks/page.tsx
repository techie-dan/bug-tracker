import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { WebhookManagement } from "@/components/webhook-management";

export const metadata = { title: "Webhooks" };

export default async function WebhooksSettingsPage() {
  if (!isAgentPlatformEnabled()) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <Link href="/settings" className="text-sm text-teal-700 hover:underline">
            ← Back to settings
          </Link>
          <h1 className="text-2xl font-semibold text-slate-900">Webhooks</h1>
          <p className="text-sm text-slate-600">
            The agent platform feature is not enabled in this environment.
          </p>
        </div>
      </div>
    );
  }

  await requireUser();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href="/settings" className="text-sm text-teal-700 hover:underline">
          ← Back to settings
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">Webhooks</h1>
        </div>
        <p className="text-sm text-slate-600">
          Manage webhook subscriptions for your agents. Events are delivered to
          each subscription&rsquo;s HTTPS endpoint with HMAC-SHA256 signatures.
        </p>
      </div>
      <WebhookManagement />
    </div>
  );
}
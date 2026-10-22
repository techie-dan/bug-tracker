import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { findPendingPairing } from "@/lib/agents/pairing";
import { projectContextFor } from "@/lib/project-context";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { PairForm } from "./pair-form";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";

export const metadata = { title: "Approve an agent" };

/** Where an agent sends its owner to approve a request (#427). */
export default async function PairAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const user = await requireUser();
  if (!isAgentPlatformEnabled()) {
    // #505: nothing to approve while the platform is off.
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Approve an agent</h1>
          <p className="text-sm text-slate-600">The agent platform feature is not enabled in this environment.</p>
        </div>
      </div>
    );
  }
  const tenantId = await currentTenantIdFor(user.id);
  const context = await projectContextFor(prisma, tenantId);
  const { code } = await searchParams;
  const initialCode = typeof code === "string" ? code.slice(0, 20) : "";
  const pending = initialCode ? await findPendingPairing(initialCode) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href="/settings/agents" className="text-sm text-teal-700 hover:underline">
          ← Back to agents
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">Approve an agent</h1>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <p className="text-sm text-slate-600">
          Your agent asked to join this account. Check its name and approve it. You have to be signed
          in. The request lasts 15 minutes and works once. The key goes back to the agent, not to this page.
        </p>
        {!tenantId ? (
          <p className="mt-4 text-sm text-slate-700">
            Join or create a workspace before you can approve an agent.{" "}
            <Link href="/tenants" className="font-medium text-teal-700 hover:underline">
              Workspaces
            </Link>
          </p>
        ) : (
          <PairForm
            initialCode={initialCode}
            pending={pending ? { name: pending.proposedName, model: pending.proposedModel, level: pending.proposedLevel } : null}
            unknownCode={Boolean(initialCode) && !pending}
            projects={context.projects}
            activeProjectId={context.activeProjectId}
          />
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { projectContextFor } from "@/lib/project-context";
import { getSiteUrl } from "@/lib/site-url";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { getAgentTemplates } from "@/lib/agents/templates";
import { ConnectAgentView } from "./connect-agent-view";

export const metadata = { title: "Connect your agent" };

/**
 * Connect your agent onboarding page (#610).
 * Ready-to-paste setups for Claude, ChatGPT, and Node/Python pollers.
 */
export default async function ConnectAgentPage() {
  const user = await requireUser();

  if (!isAgentPlatformEnabled()) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Connect your agent</h1>
          <p className="text-sm text-slate-600">The agent platform feature is not enabled in this environment.</p>
        </div>
      </div>
    );
  }

  const tenantId = await currentTenantIdFor(user.id);
  const context = await projectContextFor(prisma, tenantId);

  const activeProject =
    context.projects.find((p) => p.id === context.activeProjectId) ??
    context.projects[0] ??
    null;

  const projectId = activeProject?.id ?? null;
  const projectName = activeProject?.name ?? null;
  const siteUrl = getSiteUrl();

  const templates = getAgentTemplates({
    origin: siteUrl,
    projectId,
    projectName,
  });

  // Check if an agent for this project has already made a call
  const initialKey = tenantId
    ? await prisma.agentApiKey.findFirst({
        where: {
          agent: { ownerUserId: user.id, tenantId, revokedAt: null },
          ...(projectId ? { projectId } : {}),
          lastUsedAt: { not: null },
        },
        include: { agent: { select: { name: true } } },
        orderBy: { lastUsedAt: "desc" },
      })
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href="/settings/agents" className="text-sm text-teal-700 hover:underline">
          ← Back to agents
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">Connect your agent</h1>
          <Link
            href="/settings/agents/pair"
            className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-900 hover:underline"
          >
            Approve a pairing code →
          </Link>
        </div>
        <p className="text-sm text-slate-600">
          Connect a separate agent for each level you use. Pick your assistant, copy the setup block, approve the pairing request, and test your connection.
        </p>
      </div>

      {!tenantId ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          <p>
            You are not currently in a workspace. Join or create a workspace before you can connect an agent.
          </p>
          <div className="mt-3">
            <Link
              href="/tenants"
              className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800"
            >
              Workspaces →
            </Link>
          </div>
        </div>
      ) : (
        <ConnectAgentView
          templates={templates}
          siteUrl={siteUrl}
          projectId={projectId}
          projectName={projectName}
          initialConnected={Boolean(initialKey?.lastUsedAt)}
          initialAgentName={initialKey?.agent?.name ?? null}
        />
      )}
    </div>
  );
}

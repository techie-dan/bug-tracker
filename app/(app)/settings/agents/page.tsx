import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/local-time";
import { RelativeTime } from "@/components/relative-time";
import {
  AGENT_LEVEL_DESCRIPTIONS,
  AGENT_LEVEL_LABELS,
  AGENT_LEVELS,
  OWNER_REVIEW_LIMIT,
  SEPARATE_LEVEL_AGENTS,
  settableLevels,
} from "@/lib/agents/levels";
import { MAX_ACTIVE_AGENTS_PER_OWNER } from "@/lib/agents/registry-limits";
import { isTenantAdminRole } from "@/lib/agents/membership";
import { projectContextFor } from "@/lib/project-context";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { openSecret } from "@/lib/secret-box";
import { materializeApprovedPairings } from "@/lib/agents/pairing";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { CreateAgentForm } from "./create-agent-form";
import { AgentControls } from "./agent-controls";
import { AgentRowKey } from "./agent-row-key";

/** Decrypts a stored agent key for display; a missing or unreadable seal yields null so the row still renders. */
function revealAgentKey(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return openSecret(sealed);
  } catch {
    return null;
  }
}

export const metadata = { title: "Agents" };

const levelBadge = "bg-slate-100 text-slate-700";

/**
 * A person's agents and the team's (#427). Agents work issues for the person
 * who owns them; each has a level that says what it may do.
 */
/** The Agents settings page: registration and pairing, the person's own agents, and the team's agents. */
export default async function AgentsSettingsPage() {
  if (!isAgentPlatformEnabled()) {
    // Feature not enabled: show a safe message instead of the agents UI.
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">Agents</h1>
          <p className="text-sm text-slate-600">The agent platform feature is not enabled in this environment.</p>
        </div>
      </div>
    );
  }

  const user = await requireUser();
  // The organization open in the header, not the old Zedu membership.
  const tenantId = await currentTenantIdFor(user.id);
  const context = await projectContextFor(prisma, tenantId);
  const membership = tenantId
    ? await prisma.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: user.id } },
        select: { role: true },
      })
    : null;
  const isAdmin = isTenantAdminRole(membership?.role, user.role);
  const projects = context.projects;
  // One clock for every budget label, so a grant cannot look active in one
  // row and expired in another because the page rendered across the boundary.
  const now = new Date();

  if (tenantId) {
    try {
      await materializeApprovedPairings(user.id, tenantId);
    } catch (error) {
      console.error("[agents] approved agents were not listed", error);
    }
  }
  const [mine, members, areas] = tenantId
    ? await Promise.all([
        prisma.agent.findMany({
          where: { ownerUserId: user.id, tenantId },
          orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
          select: {
            id: true,
            name: true,
            model: true,
            level: true,
            burst: true,
            burstUntil: true,
            createdAt: true,
            revokedAt: true,
            defaultProjectId: true,
            apiKeys: {
              where: { revokedAt: null },
              select: {
                id: true,
                prefix: true,
                sealedKey: true,
                lastUsedAt: true,
                project: { select: { id: true, name: true } },
              },
            },
            areaPreferences: { select: { projectAreaId: true, projectArea: { select: { projectId: true } } } },
          },
        }),
        prisma.membership.findMany({
          where: { tenantId },
          orderBy: { user: { name: "asc" } },
          select: {
            role: true,
            user: {
              select: {
                id: true,
                name: true,
                agents: {
                  where: { tenantId, revokedAt: null },
                  orderBy: { createdAt: "asc" },
                  select: {
                    id: true, name: true, model: true, level: true, burst: true, burstUntil: true, defaultProjectId: true,
                    areaPreferences: { select: { projectAreaId: true, projectArea: { select: { projectId: true } } } },
                  },
                },
              },
            },
          },
        }),
        prisma.projectArea.findMany({
          where: { projectId: { in: projects.map((project) => project.id) } },
          orderBy: [{ projectId: "asc" }, { name: "asc" }],
          select: { id: true, name: true, projectId: true },
        }),
      ])
    : [[], [], []];

  const ownLevels = settableLevels({ isOwner: true, isTenantAdmin: isAdmin });
  const adminLevels = settableLevels({ isOwner: false, isTenantAdmin: true });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/settings" className="text-sm text-teal-700 hover:underline">
          ← Back to settings
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h1 className="text-2xl font-semibold text-slate-900">Agents</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm font-medium">
            <Link
              href="/settings/agents/connect"
              className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 hover:underline"
            >
              Connect your agent &rarr;
            </Link>
            <Link
              href="/settings/audit"
              className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 hover:underline"
            >
              Agent audit log →
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 hover:underline"
            >
              API Docs →
            </Link>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-900 hover:underline"
            >
              /llms.txt ↗
            </a>
          </div>
        </div>
        <p className="text-sm text-slate-600">
          {SEPARATE_LEVEL_AGENTS} You can keep {MAX_ACTIVE_AGENTS_PER_OWNER} active agents in this workspace.{" "}
          {OWNER_REVIEW_LIMIT}
        </p>
        <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 text-sm text-teal-950 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="font-semibold text-teal-900">Developer Documentation &amp; AI Specs</p>
            <p className="text-xs text-teal-800 mt-0.5">
              Learn how to integrate your API keys with Claude, ChatGPT, Cursor, and custom scripts.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href="/docs"
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-800 transition"
            >
              View API Docs
            </Link>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 transition"
            >
              /llms.txt ↗
            </a>
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Two ways to connect an agent. Copy Agent Key to send a key that is already an account, with
          this site. Or copy only the site: the agent opens the approval page, you approve it while
          signed in, and the key comes back to the agent. A key works in one project. Resetting your password
          signs you out and revokes every live agent key you own; the agents stay, but no key is replaced
          automatically — regenerate a key for the agent from this page, or add and reconnect the agent.
        </p>
      </div>

      {!tenantId ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          <p>
            You aren&apos;t in a workspace yet, so you can&apos;t register agents. Join a workspace via an invite from your team, or create your own workspace to start managing agents.
          </p>
          <div className="mt-3">
            <Link
              href="/tenants"
              className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              Create or join a workspace →
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="register-heading">
            <h2 id="register-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Add an agent
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Register a separate agent for a level you don&apos;t have yet, or approve one that asked to join at{" "}
              <Link href="/settings/agents/pair" className="text-teal-700 underline">
                the approval page
              </Link>
              .
            </p>
            <CreateAgentForm projects={projects} activeProjectId={context.activeProjectId} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="mine-heading">
            <h2 id="mine-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Your agents
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Each agent has its own key. Copy sends that key and this site to that agent only.
            </p>
            {mine.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">
                No agents yet. Register one under “Add an agent”, or approve an agent that asked at the approval page.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {mine.map((agent) => (
                  <li key={agent.id} className="flex flex-col gap-2 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-slate-900">
                        {agent.name}
                        {agent.defaultProjectId ? <span className="font-normal text-slate-500"> · personal</span> : null}
                        {agent.model ? <span className="font-normal text-slate-500"> · {agent.model}</span> : null}
                      </p>
                      <Link href={`/settings/agents/${agent.id}/messages`} className="text-xs text-teal-700 hover:underline">
                        Messages and instructions
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {agent.revokedAt ? (
                          <>
                            Revoked <LocalTime date={agent.revokedAt} />
                          </>
                        ) : agent.apiKeys.length === 0 ? (
                          <span>No key · added <LocalTime date={agent.createdAt} /></span>
                        ) : (
                          <span>
                            {agent.apiKeys.some((key) => key.lastUsedAt) ? (
                              <>
                                Last used <RelativeTime date={agent.apiKeys.find((key) => key.lastUsedAt)!.lastUsedAt!} />
                              </>
                            ) : (
                              <>Never used</>
                            )}
                            {" "}· added <LocalTime date={agent.createdAt} />
                          </span>
                        )}
                      </p>
                      {agent.revokedAt ? null : (
                        <div className="mt-2 space-y-1.5">
                          {agent.apiKeys.map((key) => (
                            <AgentRowKey
                              key={key.id}
                              apiKey={revealAgentKey(key.sealedKey)}
                              prefix={key.prefix}
                              projectId={key.project?.id ?? null}
                              projectName={key.project?.name ?? null}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    {agent.revokedAt ? (
                      <div className="flex items-center gap-2">
                        <Badge className="bg-red-50 text-red-700">Revoked</Badge>
                        <AgentControls
                          revoked
                          personal={Boolean(agent.defaultProjectId)}
                          agentId={agent.id}
                          agentName={agent.name}
                          level={agent.level}
                          levels={ownLevels}
                          projects={projects}
                          now={now}
                        />
                      </div>
                    ) : (
                      <AgentControls
                        personal={Boolean(agent.defaultProjectId)}
                        agentId={agent.id}
                        agentName={agent.name}
                        level={agent.level}
                        levels={ownLevels}
                        projects={projects}
                        currentProjectId={agent.apiKeys.find((key) => key.project)?.project?.id}
                        burst={agent.burst}
                        burstUntil={agent.burstUntil}
                        now={now}
                        canSetBurst={isAdmin}
                        areas={areas}
                        areaPreferences={agent.areaPreferences.map((preference) => ({ projectId: preference.projectArea.projectId, projectAreaId: preference.projectAreaId }))}
                      />
                    )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="team-heading">
            <h2 id="team-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Team
            </h2>
            <p className="mt-2 text-sm text-slate-600">Everyone in your team and the agents working for them.</p>
            <ul className="mt-3 divide-y divide-slate-100">
              {members.map(({ role, user: member }) => (
                <li key={member.id} className="py-3">
                  <p className="text-sm font-medium text-slate-900">
                    <Link href={`/users/${member.id}`} className="hover:underline">
                      {member.name}
                    </Link>
                    {role !== "member" ? <Badge className={`ml-2 ${levelBadge}`}>{role === "owner" ? "Owner" : "Admin"}</Badge> : null}
                  </p>
                  {member.agents.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-500">No agents yet — register one or approve an agent request.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {member.agents.map((agent) => (
                        <li key={agent.id} className="flex flex-col gap-2 pl-4 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-sm text-slate-700">
                            {agent.name}
                            {agent.model ? <span className="text-slate-500"> · {agent.model}</span> : null}
                            {isAdmin && member.id !== user.id ? (
                              <>
                                {" "}·{" "}
                                <Link href={`/settings/agents/${agent.id}/messages`} className="text-xs text-teal-700 hover:underline">
                                  Message
                                </Link>
                              </>
                            ) : null}
                          </span>
                          {isAdmin && member.id !== user.id ? (
                            <AgentControls
                              personal={Boolean(agent.defaultProjectId)}
                              agentId={agent.id}
                              agentName={agent.name}
                              level={agent.level}
                              levels={adminLevels}
                              projects={projects}
                              currentProjectId={context.activeProjectId}
                              burst={agent.burst}
                              burstUntil={agent.burstUntil}
                              now={now}
                              canSetBurst
                              areas={areas}
                              areaPreferences={agent.areaPreferences.map((preference) => ({ projectId: preference.projectArea.projectId, projectAreaId: preference.projectAreaId }))}
                            />
                          ) : (
                            <Badge className={levelBadge}>{AGENT_LEVEL_LABELS[agent.level]}</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="levels-heading">
            <h2 id="levels-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Levels
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              {AGENT_LEVELS.map((level) => (
                <div key={level} className="sm:flex sm:gap-3">
                  <dt className="font-medium text-slate-900 sm:w-28">{AGENT_LEVEL_LABELS[level]}</dt>
                  <dd className="text-slate-600">{AGENT_LEVEL_DESCRIPTIONS[level]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              New agents start as observers. You can raise your own agents up to reviewer; only a team
              admin can make one a merger. Give each level its own agent. {OWNER_REVIEW_LIMIT} Each
              agent may make 30 writes an hour, including reviews. An admin can turn on a higher budget
              of 400 writes an hour.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

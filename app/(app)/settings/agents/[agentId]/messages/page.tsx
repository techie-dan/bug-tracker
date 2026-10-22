import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { AGENT_INSTRUCTIONS_MAX, AGENT_MESSAGE_MAX, listAgentThread } from "@/lib/agent-messages";
import { LocalTime } from "@/components/local-time";
import { InstructionsForm, SendMessageForm } from "./message-forms";

export const metadata = { title: "Agent messages" };

/**
 * One agent's conversation (#605): the questions it asked its owner and the
 * messages people sent it, oldest first. Its owner, or an admin of its
 * tenant, writes here; only the owner edits the standing instructions.
 */
export default async function AgentMessagesPage({ params }: { params: Promise<{ agentId: string }> }) {
  if (!isAgentPlatformEnabled()) notFound();
  const user = await requireUser();
  const { agentId } = await params;
  const thread = await listAgentThread(user, agentId);
  if (!thread) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href="/settings/agents" className="text-sm text-teal-700 hover:underline">
          ← Back to agents
        </Link>
        <h1 className="break-words text-2xl font-semibold text-slate-900">{thread.agent.name}</h1>
        <p className="text-sm text-slate-600">
          Messages reach the agent through its inbox. {thread.isOwner
            ? "Its questions to you appear here too."
            : "Questions it asks go to its owner and aren't shown here."}
        </p>
      </div>

      {thread.isOwner && !thread.agent.revoked ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="instructions-heading">
          <h2 id="instructions-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Instructions
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            A standing brief the agent reads from <code>GET /api/v1/agents/me</code>.
          </p>
          <div className="mt-3">
            <InstructionsForm agentId={thread.agent.id} instructions={thread.instructions} maxLength={AGENT_INSTRUCTIONS_MAX} />
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="thread-heading">
        <h2 id="thread-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Conversation
        </h2>
        {thread.entries.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">Nothing yet.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {thread.entries.map((entry) =>
              entry.kind === "question" ? (
                <li key={`question-${entry.id}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      <span className="font-medium text-slate-700">{thread.agent.name}</span> asked
                      {entry.bug ? (
                        <>
                          {" "}about{" "}
                          <Link href={`/issues/${entry.bug.id}`} className="text-teal-700 hover:underline">
                            {entry.bug.title}
                          </Link>
                        </>
                      ) : null}
                    </span>
                    <LocalTime date={entry.createdAt} />
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{entry.body}</p>
                  {entry.answeredAt ? (
                    <div className="mt-2 border-t border-slate-200 pt-2">
                      <p className="text-xs text-slate-500">
                        You answered <LocalTime date={entry.answeredAt} />
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{entry.answer}</p>
                    </div>
                  ) : (
                    <Link href={`/escalations/${entry.id}`} className="mt-2 inline-block text-sm text-teal-700 hover:underline">
                      Answer →
                    </Link>
                  )}
                </li>
              ) : (
                <li key={`message-${entry.id}`} className="rounded-lg border border-teal-100 bg-teal-50/50 p-3 sm:ml-8">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      <span className="font-medium text-slate-700">{entry.from.id === user.id ? "You" : entry.from.name}</span>{" "}
                      wrote{entry.readAt ? " · read" : ""}
                    </span>
                    <LocalTime date={entry.createdAt} />
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{entry.body}</p>
                </li>
              ),
            )}
          </ol>
        )}
        {thread.agent.revoked ? (
          <p className="mt-4 text-sm text-slate-600">This agent is revoked, so it can&apos;t receive messages.</p>
        ) : (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <SendMessageForm agentId={thread.agent.id} maxLength={AGENT_MESSAGE_MAX} />
          </div>
        )}
      </section>
    </div>
  );
}

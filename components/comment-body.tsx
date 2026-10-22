import type { ReactNode } from "react";
import { RichText } from "@/components/rich-text";
import { parseAgentMentionId, tokenizeMentions } from "@/lib/mentions";

type UserOption = { id: string; name: string };

/** The bot badge on agent mentions and agent suggestions (#603). */
export function AgentMentionBadge() {
  return (
    <span
      className="rounded bg-slate-200/90 px-1 text-[10px] font-medium text-slate-700"
      aria-hidden="true"
    >
      bot
    </span>
  );
}

function MentionPill({ name, id }: { name: string; id: string }) {
  const agent = parseAgentMentionId(id) !== null;
  return (
    <span
      title={agent ? `${name} (agent)` : name}
      data-user-id={agent ? undefined : id}
      data-agent-id={agent ? parseAgentMentionId(id) ?? undefined : undefined}
      className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-800 ring-1 ring-inset ring-teal-200"
    >
      @{name}
      {agent ? <AgentMentionBadge /> : null}
    </span>
  );
}

function MentionSpans({
  text,
  userMap,
}: {
  text: string;
  userMap?: Map<string, string>;
}): ReactNode {
  const tokens = tokenizeMentions(text);

  return tokens.map((token, index) => {
    if (token.type === "text") {
      return <span key={`t-${index}`}>{token.value}</span>;
    }

    if (userMap) {
      const realName = userMap.get(token.userId);
      if (!realName) {
        return <span key={`t-${index}`}>@{token.name}</span>;
      }
      return <MentionPill key={`m-${index}-${token.userId}`} name={realName} id={token.userId} />;
    }

    return <MentionPill key={`m-${index}-${token.userId}`} name={token.name} id={token.userId} />;
  });
}

/** Renders `@[Name](userId)` tags as mention pills (used by the editor preview). */
export function MentionText({
  text,
  users,
}: {
  text: string;
  users?: UserOption[];
}): ReactNode {
  const userMap = users ? new Map(users.map((u) => [u.id, u.name])) : undefined;
  return <MentionSpans text={text} userMap={userMap} />;
}

export function CommentBody({
  body,
  users,
}: {
  body: string;
  users?: UserOption[];
}) {
  const userMap = users
    ? new Map(users.map((u) => [u.id, u.name]))
    : undefined;

  return (
    <RichText
      content={body}
      className="mt-2 text-sm"
      renderMentions={(text) => (
        <MentionSpans text={text} userMap={userMap} />
      )}
    />
  );
}

import type { ActivityType } from "@prisma/client";
import { activityNote } from "@/lib/resolution-note";
import { LocalTime } from "@/components/local-time";
import { ExpandableText } from "@/components/expandable-text";

export type ActivityEntry = {
  id: string;
  type: ActivityType;
  summary: string;
  createdAt: Date;
  actor: { name: string };
  metadata?: unknown;
};

const typeLabel: Record<ActivityType, string> = {
  created: "Created",
  status_changed: "Status",
  severity_changed: "Severity",
  assignee_changed: "Assignee",
  commented: "Comment",
  edited: "Edit",
  milestone_changed: "Milestone",
  boosted: "Boost",
  unboosted: "Unboost",
  deleted: "Deleted",
  restored: "Restored",
  comment_deleted: "Moderation",
  type_changed: "Type",
  category_changed: "Category",
  area_changed: "Area",
  duplicate_changed: "Duplicate",
};

export function ActivityTimeline({
  activities,
  totalCount,
}: {
  /** The newest entries, oldest first. May be fewer than `totalCount`. */
  activities: ActivityEntry[];
  /** Every entry on the issue, so the heading does not under-report. */
  totalCount?: number;
}) {
  const total = totalCount ?? activities.length;
  const trimmed = total > activities.length;
  // #418: collapse the read-only history by default so long activity lists
  // stop pushing the conversation down the page. Native details/summary keeps
  // the component server-rendered, works with mouse, keyboard and without
  // JavaScript, and browsers auto-open the section when a URL targets an
  // entry inside it. Issues without activity keep the empty state visible.
  if (activities.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Activity ({total})
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Read-only history of changes on this issue.
        </p>
        <p className="mt-4 text-sm text-slate-500">No activity recorded yet.</p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <details className="group">
        <summary className="cursor-pointer list-none select-none -m-1 rounded-md p-1 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
          <span className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Activity ({total})
            </h2>
            <span
              aria-hidden="true"
              className="shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-90"
            >
              ▸
            </span>
          </span>
          <p className="mt-1 text-xs text-slate-500">
            Read-only history of changes on this issue.
            {trimmed
              ? ` Showing the ${activities.length} most recent of ${total}.`
              : ""}
          </p>
        </summary>
        <ol className="relative mt-5 space-y-0 border-l border-slate-200 pl-4 sm:pl-5">
          {activities.map((entry) => (
            <li key={entry.id} className="relative pb-5 last:pb-0">
              <span
                aria-hidden
                className="absolute -left-[1.2rem] sm:-left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-teal-600"
              />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {typeLabel[entry.type]}
                </span>
                <LocalTime
                  className="text-xs text-slate-500"
                  date={entry.createdAt}
                />
              </div>
              <p className="mt-1 text-sm text-slate-800">
                <span className="font-medium text-slate-900">
                  {entry.actor.name}
                </span>{" "}
                <ExpandableText maxLines={2} expandText="View more" collapseText="View less">
                  {entry.summary}
                </ExpandableText>
              </p>
              {entry.type === "status_changed" && activityNote(entry.metadata) ? (
                <ExpandableText maxLines={3} expandText="View more" collapseText="View less">
                  <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-emerald-300 pl-3 text-sm text-slate-700">
                    {activityNote(entry.metadata)}
                  </blockquote>
                </ExpandableText>
              ) : null}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

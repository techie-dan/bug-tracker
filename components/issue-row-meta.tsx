import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { ShortTime } from "@/components/short-time";

/**
 * Taxonomy a row shows as a coloured pill. Ordered: the three that answer
 * "what is this and how urgent is it" (type, severity, status) stay first, so
 * they survive the three-pill cap; the rest fall into the +N overflow chip
 * (#686).
 */
export type RowPill = {
  /** Stable key, and the name the overflow chip's tooltip lists. */
  name: string;
  /** Full class string for the pill, border + background + text. */
  className: string;
  /** Pill contents; defaults to the name. */
  content?: ReactNode;
};

interface IssueRowMetaProps {
  /** Pills in priority order; only the first three are shown, the rest fold into +N. */
  pills: RowPill[];
  /** Muted second line under the title: category, area, assignee, age, counts (#686). */
  meta: ReactNode;
}

/** How many pills a row may show before the rest fold into the +N chip. */
export const MAX_VISIBLE_PILLS = 3;

/**
 * The badge line for one issue row: at most three pills plus a +N overflow
 * chip, so the taxonomy never buries the title or the metadata (#686).
 *
 * The overflow chip lists what it hides in its `title`, and names the hidden
 * pills to screen readers, so nothing is lost — it is only quieter.
 */
export function IssueRowPills({ pills }: { pills: RowPill[] }) {
  const visible = pills.slice(0, MAX_VISIBLE_PILLS);
  const hidden = pills.slice(MAX_VISIBLE_PILLS);

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      {visible.map((pill) => (
        <span
          key={pill.name}
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${pill.className}`}
        >
          {pill.content ?? pill.name}
        </span>
      ))}
      {hidden.length > 0 ? (
        <span
          className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600"
          title={`Also: ${hidden.map((pill) => pill.name).join(", ")}`}
          aria-label={`${hidden.length} more: ${hidden.map((pill) => pill.name).join(", ")}`}
        >
          +{hidden.length}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The muted line under a row's pills. Everything here is one rhymeless,
 * low-contrast line so the eye can scan it without competing with the title
 * (#686). Kept as one component so the separators stay uniform.
 */
export function IssueRowMeta({ pills, meta }: IssueRowMetaProps) {
  return (
    <div className="min-w-0 space-y-1">
      <IssueRowPills pills={pills} />
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 truncate text-xs text-slate-500 pt-0.5">
        {meta}
      </p>
    </div>
  );
}

/** A `·` separator that collapses with the flex gap, so an empty neighbour leaves no dangling dot. */
export function MetaSeparator() {
  return <span aria-hidden="true">·</span>;
}

/**
 * The assignee as a face only (#1061): who it is matters less than that
 * someone has it. The name is in the tooltip and read out in full.
 */
export function RowAssignee({ name, image }: { name: string; image?: string | null }) {
  return (
    <span className="inline-flex shrink-0" title={`Assigned to ${name}`}>
      <Avatar name={name} image={image} size="sm" />
      <span className="sr-only">Assigned to {name}</span>
    </span>
  );
}

/**
 * The row's little date (#1061): opened or updated, matching the sort, shown
 * short ("2d") with the full date on hover and for screen readers.
 */
export function RowAge({ date, sort }: { date: Date; sort: "newest" | "updated" }) {
  return <ShortTime date={date} label={sort === "newest" ? "Opened" : "Updated"} />;
}

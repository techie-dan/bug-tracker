import type { ReactNode } from "react";

/**
 * What a page shows when its main query fails. Never the error itself: the
 * server log has that, under the same reference (lib/load-error.ts).
 */
export function LoadError({
  title,
  reference,
  children = "Something went wrong on our side. Refreshing the page usually works.",
}: {
  title: string;
  reference: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-white px-6 py-10">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{children}</p>
      <p className="mt-4 text-xs text-slate-500">
        If it keeps happening, report it with this reference:{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5">{reference}</code>
      </p>
    </div>
  );
}

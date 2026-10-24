"use client";

import Link from "next/link";
import { selectTenantAction } from "@/app/(app)/tenants/actions";
import { Select } from "@/components/ui/select";

/** A workspace the viewer belongs to and can open from the header. */
export type WorkspaceChoice = {
  id: string;
  name: string;
  slug: string;
};

function visibleName(workspace: WorkspaceChoice, shared: boolean): string {
  return shared ? `${workspace.name} (${workspace.slug})` : workspace.name;
}

/**
 * The active workspace in the header. Choosing one submits selectTenantAction,
 * the same switch the workspaces page uses. The accessible name includes the
 * workspace name on screen (WCAG 2.5.3); there is no aria-label to replace it.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeTenantId,
  className = "",
  fullWidth = false,
}: {
  workspaces: WorkspaceChoice[];
  activeTenantId: string | null;
  className?: string;
  fullWidth?: boolean;
}) {
  if (workspaces.length === 0) {
    return (
      <Link
        href="/tenants"
        className={`inline-flex h-9 items-center rounded-lg px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${fullWidth ? "w-full" : ""} ${className}`}
      >
        Workspaces
      </Link>
    );
  }

  const counts = new Map<string, number>();
  for (const workspace of workspaces) {
    const key = workspace.name.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const shared = (name: string) => (counts.get(name.toLocaleLowerCase()) ?? 0) > 1;
  const selected =
    workspaces.find((workspace) => workspace.id === activeTenantId) ?? workspaces[0];
  const selectedLabel = visibleName(selected, shared(selected.name));

  return (
    <form action={selectTenantAction} className={className}>
      <label className="block">
        <span className="sr-only">Active workspace, {selectedLabel}</span>
        <div className={fullWidth ? "w-full" : "w-44 max-w-[11rem]"}>
          <Select
            key={selected.id}
            name="tenantId"
            defaultValue={selected.id}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            title={selectedLabel}
            className="h-9 truncate py-1.5 text-xs font-medium"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {visibleName(workspace, shared(workspace.name))}
              </option>
            ))}
          </Select>
        </div>
      </label>
      <noscript>
        <button type="submit" className="mt-1 text-xs text-teal-700 underline">
          Switch workspace
        </button>
      </noscript>
    </form>
  );
}

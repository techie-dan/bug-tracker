import Link from "next/link";
import type { ReactNode } from "react";

export type PlatformTab = {
  /** A category id, `"resolved"` for resolved issues view, or `null` for All. */
  id: string | null;
  name: string;
  count: number;
  href?: string;
  active?: boolean;
  icon?: ReactNode;
};

/**
 * #1055: the platform is the main way to split the list (web and mobile
 * issues don't mix), so it gets a row of tabs above everything else.
 *
 * Each tab is a link: choosing one is a navigation, and the URL keeps it.
 * That makes this a navigation landmark with `aria-current`, not an ARIA
 * tablist, which is for panels switched in place.
 */
export function PlatformTabs({
  tabs,
  current,
  hrefFor,
}: {
  tabs: PlatformTab[];
  current?: string | null;
  hrefFor?: (id: string | null) => string;
}) {
  if (tabs.length <= 1) return null;
  return (
    <nav aria-label="Platforms" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex min-w-max items-center gap-1 border-b border-slate-200">
        {tabs.map((tab) => {
          const active = tab.active ?? (tab.id === current);
          const href = tab.href ?? (hrefFor ? hrefFor(tab.id) : "#");
          return (
            <li key={tab.id ?? "all"}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                  active
                    ? "font-semibold text-slate-900 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-teal-700"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab.icon}
                {tab.name}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                    active ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {tab.count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

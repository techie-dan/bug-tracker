import { isAdmin, isSuperAdmin, type AppRole } from "@/lib/roles";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";

export type HeaderNavSubItem = {
  href: string;
  label: string;
  description?: string;
  badge?: number;
};

export type HeaderNavItem = {
  href: string;
  label: string;
  badge?: number;
  children?: HeaderNavSubItem[];
};

/** #444: pick another tenant, create one, or accept an invite. */
export const SWITCH_TENANT_LINK: HeaderNavItem = { href: "/tenants", label: "Switch workspace" };

/** Links shown in the header for the role the user is currently viewing as (#761). */
export function headerNavItems(
  role?: AppRole | null,
  options?: { agentPlatform?: boolean; managePlatforms?: boolean; pendingEscalations?: number },
): HeaderNavItem[] {
  const manageProjectChildren: HeaderNavSubItem[] = [
    {
      href: "/projects",
      label: "Projects",
      description: "A product in this workspace, such as a web app. The switcher picks the active one.",
    },
    {
      href: "/milestones",
      label: "Milestones",
      description: "A release for this workspace. It can include issues from more than one project.",
    },
  ];

  if (options?.managePlatforms || isAdmin(role)) {
    manageProjectChildren.push({
      href: "/admin/categories",
      label: "Platforms",
      description: "A label on an issue, such as Web or Mobile. Not a product, and shared by every project here.",
    });
  }

  if (isAdmin(role)) {
    manageProjectChildren.push({
      href: "/admin/types",
      label: "Types",
      description: "How an issue is classified, such as bug or task.",
    });
  }

  const pending =
    typeof options?.pendingEscalations === "number" && options.pendingEscalations > 0
      ? options.pendingEscalations
      : undefined;

  const items: HeaderNavItem[] = [
    { href: "/issues", label: "Issues" },
    { href: "/team", label: "Team" },
    {
      href: "/projects",
      label: "Workspace",
      children: manageProjectChildren,
    },
  ];

  if (options?.agentPlatform ?? isAgentPlatformEnabled()) {
    items.push({
      href: "/escalations",
      label: "Agents",
      ...(pending ? { badge: pending } : {}),
      children: [
        {
          href: "/escalations",
          label: "Escalations",
          description: "Questions an agent is waiting on",
          ...(pending ? { badge: pending } : {}),
        },
        { href: "/redesigns", label: "Redesigns", description: "Proposed changes to review" },
        { href: "/docs", label: "API Docs", description: "Agent API and /llms.txt" },
      ],
    });
  } else {
    items.push({ href: "/docs", label: "API Docs" });
  }

  if (isSuperAdmin(role)) {
    items.push({ href: "/admin/users", label: "Admins" });
  }

  return items;
}

/**
 * Whether a header link is the current page. "Issues" covers the list and
 * individual issues, but not the "New issue" form, which has its own button.
 */
export function isNavItemActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (href === "/issues" || href === "/bugs") {
    return (
      path === "/issues" ||
      path === "/bugs" ||
      ((path.startsWith("/issues/") || path.startsWith("/bugs/")) &&
        path !== "/issues/new" &&
        path !== "/bugs/new")
    );
  }
  if (href === "/escalations" || href === "/questions") {
    return (
      path === "/escalations" ||
      path.startsWith("/escalations/") ||
      path === "/questions" ||
      path.startsWith("/questions/")
    );
  }
  if (href === "/manage-project") {
    return (
      path === "/projects" ||
      path.startsWith("/projects/") ||
      path === "/milestones" ||
      path.startsWith("/milestones/") ||
      path === "/admin/categories" ||
      path.startsWith("/admin/categories/") ||
      path === "/admin/types" ||
      path.startsWith("/admin/types/")
    );
  }
  return path === href || path.startsWith(`${href}/`);
}

/** The role a user really has, before any "View as" override. */
export function realRoleOf(flags: {
  isRealSuperAdmin?: boolean;
  isRealAdmin?: boolean;
}): AppRole {
  if (flags.isRealSuperAdmin) return "super_admin";
  if (flags.isRealAdmin) return "admin";
  return "user";
}

export const roleViewLabels: Record<AppRole, string> = {
  super_admin: "Super admin",
  admin: "Team lead (admin)",
  user: "Normal user",
};

/** Up to two initials for the account button, e.g. "Bob Builder" → "BB". */
export function initialsOf(name?: string | null): string {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  const base = clean.includes("@") ? clean.split("@")[0] : clean;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : base.slice(0, 2);
  return letters.toUpperCase();
}

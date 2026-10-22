"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { BrandLockup } from "@/components/brand-lockup";
import { WorkspaceSwitcher, type WorkspaceChoice } from "@/components/workspace-switcher";
import { PAGE_CONTAINER_CLASS } from "@/components/page-container";
import { RoleSwitcher } from "@/components/role-switcher";
import {
  SWITCH_TENANT_LINK,
  headerNavItems,
  isNavItemActive,
  realRoleOf,
  roleViewLabels,
  type HeaderNavItem,
} from "@/lib/header-nav";
import { isAdmin, type AppRole } from "@/lib/roles";
import { FOCUSABLE, wrapFocusIndex } from "@/lib/focus-trap";
import { Avatar } from "@/components/avatar";
import { ThemeToggle, AccountThemeSelector } from "@/components/theme-toggle";
import { pointsProgress, TARGET_POINTS } from "@/lib/points/rules";

/** Closes a popover on outside click or Escape, returning focus to its trigger. */
function useDismiss(
  open: boolean,
  close: () => void,
  containerRef: React.RefObject<HTMLElement | null>,
  triggerRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, containerRef, triggerRef]);
}

/**
 * While the mobile menu is open it behaves like a modal (#308): Tab cycles
 * between the toggle and the panel's controls, everything outside the header
 * is inert — unreachable by keyboard and hidden from screen readers — and
 * the page behind stops scrolling. Escape and outside clicks are handled by
 * useDismiss, which returns focus to the toggle.
 */
function useMenuFocusTrap(
  open: boolean,
  headerRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  triggerRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const header = headerRef.current;
    const panel = panelRef.current;
    if (!open || !header || !panel) return;

    // Everything beside the header — main content, the skip link, the
    // floating report button — goes inert for as long as the menu is open.
    const siblings = Array.from(header.parentElement?.children ?? []).filter(
      (el): el is HTMLElement => el !== header && el instanceof HTMLElement,
    );
    const wasInert = siblings.map((el) => el.inert);
    siblings.forEach((el) => (el.inert = true));

    const scroll = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const stops = () => [
      ...(triggerRef.current ? [triggerRef.current] : []),
      ...Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)),
    ];

    // Start on the first link, so the first Tab is already inside the menu.
    panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const list = stops();
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next = wrapFocusIndex(index, list.length, event.shiftKey);
      if (next === null) return;
      event.preventDefault();
      list[next].focus();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      siblings.forEach((el, i) => (el.inert = wasInert[i]));
      document.documentElement.style.overflow = scroll;
    };
  }, [open, headerRef, panelRef, triggerRef]);
}

function PlusIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
    </svg>
  );
}

/** Bell linking to the notification feed, with the unread count (#216). */
function NotificationsBell({ unreadCount, active }: { unreadCount: number; active: boolean }) {
  const label =
    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";
  return (
    <Link
      href="/notifications"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-slate-100 hover:text-slate-900 ${linkFocus} ${
        active ? "bg-slate-100 text-slate-900" : "text-slate-600"
      }`}
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
        />
      </svg>
      {unreadCount > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-teal-700 px-1 text-[10px] font-semibold leading-[1.125rem] text-white ring-2 ring-white"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}

const linkFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

function CountBadge({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} pending`}
      className="inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function tabClass(active: boolean) {
  return `relative inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm transition-colors ${linkFocus} ${
    active
      ? "bg-teal-50 font-medium text-teal-900"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;
}

function NavTab({ item, pathname }: { item: HeaderNavItem; pathname: string | null }) {
  const active = isNavItemActive(pathname, item.href);
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
      <span>{item.label}</span>
      {typeof item.badge === "number" && item.badge > 0 ? <CountBadge count={item.badge} /> : null}
    </Link>
  );
}

function NavMenu({
  item,
  pathname,
  open,
  onToggle,
  onClose,
}: {
  item: HeaderNavItem;
  pathname: string | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, onClose, ref, buttonRef);
  const active = item.children?.some((sub) => isNavItemActive(pathname, sub.href)) ?? false;
  const menuId = `nav-menu-${item.label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div ref={ref} className="relative flex items-stretch">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={onToggle}
        className={tabClass(active)}
      >
        <span>{item.label}</span>
        {typeof item.badge === "number" && item.badge > 0 ? <CountBadge count={item.badge} /> : null}
        <svg
          className={`h-4 w-4 text-slate-400 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={item.label}
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm"
        >
          {item.children?.map((sub) => {
            const subActive = isNavItemActive(pathname, sub.href);
            return (
              <Link
                key={sub.href}
                href={sub.href}
                role="menuitem"
                onClick={onClose}
                className={`flex flex-col rounded-lg px-3 py-2 text-sm transition-colors ${linkFocus} ${
                  subActive
                    ? "bg-teal-50 font-medium text-teal-900"
                    : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">{sub.label}</span>
                  {typeof sub.badge === "number" && sub.badge > 0 ? <CountBadge count={sub.badge} /> : null}
                </span>
                {sub.description ? (
                  <span className="font-normal text-xs text-slate-500">{sub.description}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PointsChip({
  points,
  solvedTasks,
  userId,
}: {
  points: number;
  solvedTasks: number;
  userId?: string | null;
}) {
  if (!userId) return null;
  const progress = pointsProgress(points, solvedTasks);
  const label = `${points} pts of ${TARGET_POINTS}, ${solvedTasks} solved`;
  return (
    <Link
      href={`/users/${userId}`}
      title={label}
      className={`inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-slate-700 hover:bg-slate-50 ${linkFocus}`}
    >
      <span className="text-sm font-semibold tabular-nums text-slate-900">{points}</span>
      <span className="text-xs text-slate-500">pts</span>
      <span className="sr-only"> of {TARGET_POINTS}, {solvedTasks} solved</span>
      <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-slate-200 md:block" aria-hidden="true">
        <span className="block h-full rounded-full bg-teal-700" style={{ width: `${progress.pointsPercent}%` }} />
      </span>
    </Link>
  );
}

export function AppHeader({
  userName,
  userImage,
  role,
  isRealSuperAdmin,
  isRealAdmin,
  unreadCount = 0,
  pendingEscalationsCount = 0,
  userId,
  workspaces = [],
  activeTenantId = null,
  canManagePlatforms = false,
  points = 0,
  solvedTasks = 0,
}: {
  userName?: string | null;
  /** Their picture, if their sign-in provider gave one (#290). */
  userImage?: string | null;
  role?: AppRole | null;
  isRealSuperAdmin?: boolean;
  isRealAdmin?: boolean;
  /** Unread in-app notifications (#216). */
  unreadCount?: number;
  /** Unresolved escalations from agents (#763). */
  pendingEscalationsCount?: number;
  userId?: string | null;
  /** Workspaces this person can open, and the one currently active. */
  workspaces?: WorkspaceChoice[];
  activeTenantId?: string | null;
  /** Owner or admin of the organization currently open. */
  canManagePlatforms?: boolean;
  /** This person's points in the open workspace. */
  points?: number;
  solvedTasks?: number;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const accountRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);

  const closeAccount = () => setAccountOpen(false);
  const closeMenu = () => setMenuOpen(false);
  useDismiss(accountOpen, closeAccount, accountRef, accountButtonRef);
  useDismiss(menuOpen, closeMenu, headerRef, menuButtonRef);
  useMenuFocusTrap(menuOpen, headerRef, menuPanelRef, menuButtonRef);

  // Close menus when the page changes (state adjusted during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
    setAccountOpen(false);
    setOpenMenu(null);
  }

  const items = headerNavItems(role, {
    managePlatforms: canManagePlatforms,
    pendingEscalations: pendingEscalationsCount,
  });
  const canSwitchRole = Boolean((isRealSuperAdmin || isRealAdmin) && role);
  const realRole = realRoleOf({ isRealSuperAdmin, isRealAdmin });
  const viewingAsOther = canSwitchRole && role !== realRole;
  const onNewIssue =
    pathname?.replace(/\/+$/, "") === "/issues/new" ||
    pathname?.replace(/\/+$/, "") === "/bugs/new";
  const effectiveRole: AppRole = role ?? "user";

  return (
    <header ref={headerRef} className="sticky top-0 z-40">
      {/* Blur lives on its own layer. backdrop-filter on the header itself
          clips overflow, which hid the account menu under the bar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80"
      />
      <div className={`relative flex h-14 items-center gap-4 sm:gap-6 ${PAGE_CONTAINER_CLASS}`}>
        <div className="shrink-0">
          <BrandLockup href="/issues" size="sm" />
        </div>

        {/* Active workspace. Below lg it moves into the menu. */}
        <div className="hidden shrink-0 lg:block">
          <WorkspaceSwitcher workspaces={workspaces} activeTenantId={activeTenantId} />
        </div>

        <nav aria-label="Main" className="hidden h-full min-w-0 items-center lg:flex">
          {items.map((item) =>
            item.children && item.children.length > 0 ? (
              <NavMenu
                key={item.label}
                item={item}
                pathname={pathname}
                open={openMenu === item.label}
                onToggle={() => setOpenMenu((current) => (current === item.label ? null : item.label))}
                onClose={() => setOpenMenu(null)}
              />
            ) : (
              <NavTab key={item.href} item={item} pathname={pathname} />
            ),
          )}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          <PointsChip points={points} solvedTasks={solvedTasks} userId={userId} />
          {viewingAsOther ? (
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              className={`hidden items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 lg:inline-flex ${linkFocus}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              Viewing as {roleViewLabels[effectiveRole].toLowerCase()}
            </button>
          ) : null}

          <NotificationsBell
            unreadCount={unreadCount}
            active={isNavItemActive(pathname, "/notifications")}
          />

          <ThemeToggle />

          <Link
            href="/issues/new"
            aria-current={onNewIssue ? "page" : undefined}
            aria-label="New issue"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full bg-teal-700 px-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-800 sm:px-3.5 ${linkFocus}`}
          >
            <PlusIcon />
            <span className="hidden sm:inline">New issue</span>
          </Link>

          {/* Desktop account menu */}
          <div ref={accountRef} className="relative hidden lg:block">
            <button
              ref={accountButtonRef}
              type="button"
              aria-haspopup="true"
              aria-expanded={accountOpen}
              aria-controls="account-menu"
              onClick={() => setAccountOpen((open) => !open)}
              className={`relative flex items-center gap-1 rounded-full p-0.5 pr-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 ${linkFocus}`}
            >
              <span className="sr-only">Account menu for {userName}</span>
              <Avatar name={userName} image={userImage} size="md" />
              {viewingAsOther ? (
                <span
                  className="absolute left-6 top-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500 lg:hidden"
                  aria-hidden="true"
                />
              ) : null}
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {accountOpen ? (
              <div
                id="account-menu"
                className="absolute right-0 top-full z-50 mt-2 w-64 origin-top-right rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm motion-safe:animate-[header-pop_120ms_ease-out]"
              >
                <AccountSummary userName={userName} userImage={userImage} role={effectiveRole} realRole={realRole} />
                {canSwitchRole ? (
                  <div className="border-t border-slate-100 px-2 py-2.5">
                    <RoleSwitcher activeRole={effectiveRole} isSuperAdmin={isRealSuperAdmin} />
                  </div>
                ) : null}
                <div className="border-t border-slate-100 pt-1.5">
                  <AccountThemeSelector />
                  {isAdmin(effectiveRole) ? (
                    <MenuLink
                      href="/admin/dashboard"
                      active={isNavItemActive(pathname, "/admin/dashboard")}
                    >
                      Dashboard
                    </MenuLink>
                  ) : null}
                  <MenuLink
                    href={SWITCH_TENANT_LINK.href}
                    active={isNavItemActive(pathname, SWITCH_TENANT_LINK.href)}
                  >
                    {SWITCH_TENANT_LINK.label}
                  </MenuLink>
                  <MenuLink href="/settings" active={isNavItemActive(pathname, "/settings")}>
                    Settings
                  </MenuLink>
                  <MenuLink href="/docs" active={isNavItemActive(pathname, "/docs")}>
                    Docs & /llms.txt
                  </MenuLink>
                  <SignOutButton userId={userId} className={linkFocus} />
                </div>
              </div>
            ) : null}
          </div>

          {/* Mobile menu toggle */}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:hidden ${linkFocus}`}
          >
            {viewingAsOther ? (
              <span
                className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500"
                aria-hidden="true"
              />
            ) : null}
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen ? (
        <div
          id="mobile-menu"
          ref={menuPanelRef}
          className="relative max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-slate-200 bg-white px-4 pb-4 pt-2 lg:hidden"
        >
          <div className="border-b border-slate-200 pb-3">
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeTenantId={activeTenantId}
              fullWidth
            />
          </div>
          <nav aria-label="Main" className="flex flex-col py-1">
            {items.map((item) => {
              if (item.children && item.children.length > 0) {
                return (
                  <div key={item.label} className="py-1">
                    <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      {item.label}
                    </div>
                    <div className="space-y-0.5 pl-2">
                      {item.children.map((sub) => (
                        <MenuLink
                          key={sub.href}
                          href={sub.href}
                          active={isNavItemActive(pathname, sub.href)}
                          badge={sub.badge}
                          large
                        >
                          {sub.label}
                        </MenuLink>
                      ))}
                    </div>
                  </div>
                );
              }
              return (
                <MenuLink
                  key={item.href}
                  href={item.href}
                  active={isNavItemActive(pathname, item.href)}
                  badge={item.badge}
                  large
                >
                  {item.label}
                </MenuLink>
              );
            })}
            {isAdmin(effectiveRole) ? (
              <MenuLink
                href="/admin/dashboard"
                active={isNavItemActive(pathname, "/admin/dashboard")}
                large
              >
                Dashboard
              </MenuLink>
            ) : null}
            <MenuLink
              href={SWITCH_TENANT_LINK.href}
              active={isNavItemActive(pathname, SWITCH_TENANT_LINK.href)}
              large
            >
              {SWITCH_TENANT_LINK.label}
            </MenuLink>
            <MenuLink href="/settings" active={isNavItemActive(pathname, "/settings")} large>
              Settings
            </MenuLink>
            <MenuLink href="/docs" active={isNavItemActive(pathname, "/docs")} large>
              Docs & /llms.txt
            </MenuLink>
          </nav>

          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60">
            <AccountSummary userName={userName} userImage={userImage} role={effectiveRole} realRole={realRole} />
            {canSwitchRole ? (
              <div className="border-t border-slate-200 px-3 py-3">
                <RoleSwitcher activeRole={effectiveRole} isSuperAdmin={isRealSuperAdmin} />
              </div>
            ) : null}
            <div className="border-t border-slate-200 p-2">
              <AccountThemeSelector />
              <SignOutButton userId={userId} className={linkFocus} />
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function AccountSummary({
  userName,
  userImage,
  role,
  realRole,
}: {
  userName?: string | null;
  userImage?: string | null;
  role: AppRole;
  realRole: AppRole;
}) {
  return (
    <div className="flex items-center gap-3 px-2 py-2.5">
      <Avatar name={userName} image={userImage} size="lg" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{userName}</p>
        <p className="truncate text-xs text-slate-500">
          {realRole === "user" ? "Member" : roleViewLabels[realRole]}
          {role !== realRole ? (
            <span className="text-amber-700"> · viewing as {roleViewLabels[role].toLowerCase()}</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function MenuLink({
  href,
  active,
  large = false,
  badge,
  children,
}: {
  href: string;
  active: boolean;
  large?: boolean;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between rounded-md ${large ? "px-3 py-2.5 text-[15px]" : "px-2 py-1.5 text-sm"} ${linkFocus} ${
        active
          ? "bg-teal-50 font-medium text-teal-900"
          : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      <span>{children}</span>
      {typeof badge === "number" && badge > 0 ? (
        <span
          aria-label={`${badge} pending`}
          className="inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white ring-1 ring-white"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}

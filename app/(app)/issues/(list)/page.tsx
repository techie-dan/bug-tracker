import Link from "next/link";
import { Suspense } from "react";
import type { Prisma, Severity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getIssueTypes, getPlatforms } from "@/lib/lookups";
import { activeBulkOptions, loadBulkAssignees } from "@/lib/admin-list-lookups";
import { auth } from "@/auth";
import { requireUser } from "@/lib/auth-helpers";
import type { AppRole } from "@/lib/roles";
import { IssueFilters } from "@/components/issue-filters";
import {
  IssueRowMeta,
  MetaSeparator,
  RowAge,
  RowAssignee,
  type RowPill,
} from "@/components/issue-row-meta";
import { VoteButton } from "@/components/vote-button";
import {
  severityLabels,
  statusClass,
  statusLabels,
} from "@/lib/labels";
import { severities } from "@/lib/validations/issue";
import { getIssueTypeBadgeClass } from "@/lib/issue-type-styles";
import { boundSearchTerm, escapeSearchQuery, toSingleQueryParam } from "@/lib/search";
import {
  hasMatch,
  highlightSegments,
  markdownToPlain,
  matchSnippet,
  type Snippet,
} from "@/lib/search-snippet";
import { Highlighted, SearchSnippet } from "@/components/search-highlight";
import { formatIssueNumber, parseIssueNumberQuery } from "@/lib/issue-number";
import {
  SHOW_RESOLVED,
  SHOW_RESOLVED_PARAM,
  defaultStatusWhere,
  isDone,
  parseShowResolved,
  resultCountText,
  statusFilterWhere,
} from "@/lib/issue-state";
import { calculatePagination } from "@/lib/pagination";
import { issueListPaginationParams } from "@/lib/issue-list-pagination";
import { DUPLICATES_PARAM, SHOW_DUPLICATES, duplicatesWhere, parseShowDuplicates } from "@/lib/duplicates";
import { PaginationControls } from "@/components/pagination-controls";
import { fetchVoterSummaries } from "@/lib/voter-summaries";
import { dueDateValue, MILESTONE_PARAM, milestoneParamValue, milestoneWhere, parseMilestoneFilter } from "@/lib/milestones";
import { loadMilestoneSummaries } from "@/lib/milestone-stats";
import { MilestoneProgressBar } from "@/components/milestone-progress";
import { MilestoneDue } from "@/components/milestone-due";
import { createEmptyVoterSummary } from "@/lib/voters";
import {
  bugSortDescriptions,
  getBugOrderBy,
  parseBugSort,
} from "@/lib/issues-sort";
import { canDeleteTicket } from "@/lib/ticket-deletion";
import { currentTenantAccess } from "@/lib/tenant-access";
import type { OrganizationRole } from "@/lib/organization-role";
import { defaultSortFor, mineFilterWhere, parseMineFilter } from "@/lib/mine-filter";
import { finishedWatchedWhere } from "@/lib/watching";
import { UnwatchButton, UnwatchFinishedButton } from "@/components/unwatch-button";
import {
  BulkCheckbox,
  BulkSelectionProvider,
} from "@/components/bulk-selection";
import { parseTagFilter, serializeTags, tagTypeIds } from "@/lib/tag-filter";
import { bugInTenant, currentTenantIdFor, isMissingTenantColumnError } from "@/lib/tenant-context";
import { activeProjectIdFor } from "@/lib/project-context";
import { RichText } from "@/components/rich-text";
import { isOrganizationAdmin } from "@/lib/organization-role";
import { cookies } from "next/headers";
import { GettingStarted } from "@/components/getting-started";
import { GETTING_STARTED_COOKIE, gettingStartedFor, parseDismissed, type GettingStartedStep } from "@/lib/onboarding";
import {
  PLATFORM_PARAM,
  parsePlatformFilter,
  platformChoices,
  platformFilterWhere,
} from "@/lib/platform-filter";
import { PlatformTabs, type PlatformTab } from "@/components/platform-tabs";
import { LoadError } from "@/components/load-error";
import { logLoadFailure } from "@/lib/load-error";
import { AREA_PARAM, parseProjectAreaFilter, projectAreaFilterWhere } from "@/lib/project-area-filter";
import { intakeDetail, intakeLabel, openIssueStages, parseIssueStageView, type IssueStage } from "@/lib/issue-stage";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Issues" };

type SearchParams = Promise<{
  q?: string | string[];
  status?: string | string[];
  severity?: string | string[];
  platform?: string | string[];
  area?: string | string[];
  sort?: string | string[];
  page?: string | string[];
  deleted?: string | string[];
  mine?: string | string[];
  tags?: string | string[];
  [key: string]: string | string[] | undefined;
}>;

function isSeverity(value: string | undefined): value is Severity {
  return !!value && (severities as readonly string[]).includes(value);
}

async function loadOrEmpty<T>(label: string, load: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.error(`[bugs] ${label} lookup failed`, error);
    return empty;
  }
}

/** The database error stays in the server log under `reference` (#506). */
function issuesQueryError(reference: string, message?: string) {
  return (
    <LoadError title="Issues could not be loaded" reference={reference}>
      {message}
    </LoadError>
  );
}

export default async function BugsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  let userId: string | undefined;
  let effectiveRole: AppRole | null | undefined;
  let membershipRole: OrganizationRole | null = null;

  if (session?.user) {
    const user = await requireUser();
    userId = user.id;
    effectiveRole = user.role;
    membershipRole = (await currentTenantAccess(user.id, user.role)).membershipRole;
  }
  // #425: only issues in the viewer's tenant; none without a membership.
  let tenantId: string | null = null;
  let projectId: string | null = null;
  try {
    tenantId = await currentTenantIdFor(userId);
    projectId = await activeProjectIdFor(prisma, tenantId);
  } catch (error) {
    console.error("[bugs] tenant/project resolution failed", error);
  }
  const activeProject = tenantId && projectId
    ? await prisma.project.findFirst({ where: { id: projectId, tenantId }, select: { slug: true, name: true, goal: true } }).catch(() => null)
    : null;

  // #641: a short checklist for a new workspace's owner or admin, until it's
  // done or dismissed on this device.
  let gettingStarted: { tenantId: string; workspaceName: string; steps: GettingStartedStep[] } | null = null;
  if (tenantId && userId && membershipRole && isOrganizationAdmin(membershipRole, effectiveRole)) {
    try {
      const dismissed = parseDismissed((await cookies()).get(GETTING_STARTED_COOKIE)?.value);
      if (!dismissed.includes(tenantId)) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } });
        if (tenant) {
          const checklist = await gettingStartedFor(prisma, tenantId, { tenantSlug: tenant.slug });
          if (!checklist.complete) gettingStarted = { tenantId, workspaceName: tenant.name, steps: checklist.steps };
        }
      }
    } catch (error) {
      console.error("[bugs] getting-started checklist failed", error);
    }
  }

  const canDelete = canDeleteTicket(effectiveRole, membershipRole);
  const params = await searchParams;
  const qParam = toSingleQueryParam(params.q);
  const statusParam = toSingleQueryParam(params.status);
  const severityParam = toSingleQueryParam(params.severity);
  const sortParam = toSingleQueryParam(params.sort);
  const pageParam = toSingleQueryParam(params.page);
  const deletedParam = toSingleQueryParam(params.deleted);
  const mineFilter = parseMineFilter(params.mine);
  const isDeletedView = canDelete && deletedParam === "true";

  const currentSort = parseBugSort(sortParam, defaultSortFor(mineFilter));
  const isWatchingView = mineFilter === "watching" && !!userId;
  // #285: duplicates are hidden unless asked for, and the count says so.
  const showDuplicates = parseShowDuplicates(params[DUPLICATES_PARAM]);
  const where: Prisma.BugWhereInput = {
    ...bugInTenant(tenantId),
    ...(projectId ? { projectId } : {}),
    isDeleted: isDeletedView,
    ...mineFilterWhere(mineFilter, userId),
    ...duplicatesWhere(showDuplicates),
  };

  // Tag filter (#102): issue types picked from the search box.
  // These lookups are filters only. Each one fails on its own: Promise.all
  // used to throw away the ones that succeeded when Milestone was missing,
  // and the admin path below then queried them again outside this catch.
  const [tagTypes, platforms, milestones, areas, userPrefs] = await Promise.all([
    // Cached, expired by the admin actions that change them (#297).
    loadOrEmpty("issue types", () => getIssueTypes(tenantId), []),
    // Every platform, not just active ones: a link filtered on a platform
    // that was since deactivated still has to resolve. BugFilters narrows
    // the dropdown itself.
    loadOrEmpty("platforms", () => getPlatforms(tenantId), []),
    // #289: few rows; closed ones too, so an old link still resolves.
    loadOrEmpty(
      "milestones",
      () =>
        tenantId
          ? prisma.milestone.findMany({
              where: { tenantId },
              select: { id: true, title: true, isClosed: true },
              orderBy: [{ isClosed: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { title: "asc" }],
            })
          : Promise.resolve([]),
      [],
    ),
    loadOrEmpty(
      "project areas",
      () => projectId
        ? prisma.projectArea.findMany({ where: { projectId }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] })
        : Promise.resolve([]),
      [],
    ),
    userId && prisma.user?.findUnique
      ? prisma.user
          .findUnique({
            where: { id: userId },
            select: { keyboardShortcuts: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const shortcutsEnabled = userPrefs?.keyboardShortcuts ?? true;
  const selectedMilestone = parseMilestoneFilter(params[MILESTONE_PARAM], milestones);
  const milestoneParam = milestoneParamValue(selectedMilestone);
  const selectedTags = parseTagFilter(params.tags, tagTypes);
  if (selectedTags.length > 0) {
    where.typeId = { in: tagTypeIds(selectedTags, tagTypes) };
  }
  const tagsParam = serializeTags(selectedTags.map((t) => t.name));

  const statusWhere = statusFilterWhere(statusParam);
  // #1058: with no status filter, only live work shows unless resolved
  // issues were asked for. The deleted view keeps showing everything.
  const showResolved = parseShowResolved(params[SHOW_RESOLVED_PARAM]);
  const hidesResolved = statusWhere === undefined && !isDeletedView && !showResolved;
  if (statusWhere !== undefined) {
    where.status = statusWhere;
  } else if (hidesResolved) {
    where.status = defaultStatusWhere(false);
  }
  if (isSeverity(severityParam)) {
    where.severity = severityParam;
  }
  // Platform filter: one category, or the issues with none set.
  const selectedPlatform = parsePlatformFilter(params.platform, platforms);
  Object.assign(where, platformFilterWhere(selectedPlatform));
  const selectedArea = parseProjectAreaFilter(params[AREA_PARAM], areas);
  Object.assign(where, projectAreaFilterWhere(selectedArea));
  Object.assign(where, milestoneWhere(selectedMilestone));
  if (qParam?.trim()) {
    const q = escapeSearchQuery(boundSearchTerm(qParam));
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
    // "42" or "#42" should also find issue #42, which is how people quote an
    // issue to each other. Left as an OR so a title containing "42" still
    // matches too, rather than the number silently hijacking the search.
    const asNumber = parseIssueNumberQuery(qParam);
    if (asNumber !== null) where.OR.push({ number: asNumber });
  }

  // #1055: every tab counts what the other filters match, whatever platform
  // is picked, so switching tabs never surprises.
  const { categoryId: _platformClause, ...platformTabWhere } = where;
  void _platformClause;

  let totalCount = 0;
  try {
    totalCount = await prisma.bug.count({ where });
  } catch (error) {
    const reference = logLoadFailure("[bugs] list count failed", error);
    const missingColumn = isMissingTenantColumnError(error);
    if (!tenantId) {
      // No membership: nothing to show either way (#439).
      totalCount = 0;
      if (missingColumn) {
        delete where.tenantId;
        delete where.projectId;
        where.id = { in: [] };
      }
    } else if (missingColumn) {
      // #506: never retry without the tenant filter. That used to show every
      // tenant's issues to anyone whose query error mentioned the column.
      return issuesQueryError(
        reference,
        "The issue list is unavailable while the database finishes upgrading. Try again in a minute.",
      );
    } else {
      return issuesQueryError(reference);
    }
  }

  const stageView = isDeletedView ? null : parseIssueStageView(toSingleQueryParam(params.stage));
  let stages = new Map<string, IssueStage>();
  if (!isDeletedView) {
    try {
      stages = await openIssueStages(prisma, where);
    } catch (error) {
      console.error("[bugs] issue stage lookup failed", error);
    }
    if (stageView) {
      const ids = [...stages.entries()].filter(([, stage]) => stage === stageView).map(([id]) => id);
      where.id = { in: ids };
      try {
        totalCount = await prisma.bug.count({ where });
      } catch (error) {
        console.error("[bugs] stage count failed", error);
        totalCount = 0;
      }
    }
  }

  const isResolvedView = statusParam === "resolved";

  let platformTabs: PlatformTab[] = [];
  if (!isDeletedView) {
    try {
      const { status: _tabStatus, ...baseTabWhere } = platformTabWhere;
      void _tabStatus;
      const liveTabWhere: Prisma.BugWhereInput = {
        ...baseTabWhere,
        status: defaultStatusWhere(false),
      };

      const [grouped, resolvedCount] = await Promise.all([
        prisma.bug.groupBy({
          by: ["categoryId"],
          where: liveTabWhere,
          _count: { _all: true },
        }),
        prisma.bug.count({
          where: {
            ...baseTabWhere,
            status: "resolved",
          },
        }),
      ]);

      const counts = new Map(grouped.map((row) => [row.categoryId, row._count._all]));
      const all = grouped.reduce((sum, row) => sum + row._count._all, 0);

      const choices = platformChoices(platforms, selectedPlatform);
      if (choices.length > 0) {
        platformTabs = [
          { id: null, name: "All", count: all },
          // Active platforms, plus a deactivated one if a link picked it.
          ...choices.map((platform) => ({
            id: platform.id,
            name: platform.name,
            count: counts.get(platform.id) ?? 0,
          })),
          {
            id: "resolved",
            name: "Resolved",
            count: resolvedCount,
            icon: (
              <svg
                className="h-4 w-4 shrink-0 text-emerald-600"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            ),
          },
        ];
      }
    } catch (error) {
      console.error("[bugs] platform tab counts failed", error);
    }
  }
  const platformHref = (id: string | null) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "page" || key === PLATFORM_PARAM) continue;
      if (key === "status" && toSingleQueryParam(value) === "resolved") continue;
      if (key === SHOW_RESOLVED_PARAM) continue;
      const single = toSingleQueryParam(value);
      if (single) next.set(key, single);
    }
    if (id === "resolved") {
      next.set("status", "resolved");
    } else if (id) {
      next.set(PLATFORM_PARAM, id);
    }
    const qs = next.toString();
    return qs ? `/issues?${qs}` : "/issues";
  };

  // How many resolved/closed issues the default view hides (#1058).
  let hiddenResolved = 0;
  if (hidesResolved) {
    try {
      hiddenResolved = await prisma.bug.count({
        where: { ...platformTabWhere, ...platformFilterWhere(selectedPlatform), status: { in: ["resolved", "closed"] } },
      });
    } catch (error) {
      console.error("[bugs] resolved count failed", error);
    }
  }
  const resolvedHref = (() => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const single = toSingleQueryParam(value);
      if (single && key !== SHOW_RESOLVED_PARAM && key !== "page") next.set(key, single);
    }
    if (!showResolved) next.set(SHOW_RESOLVED_PARAM, SHOW_RESOLVED);
    const qs = next.toString();
    return qs ? `/issues?${qs}` : "/issues";
  })();

  // How many the default view is hiding, so "Show duplicates" can say so.
  let hiddenDuplicates = 0;
  if (!showDuplicates) {
    try {
      hiddenDuplicates = await prisma.bug.count({
        where: { ...where, duplicateOfId: { not: null } },
      });
    } catch (error) {
      console.error("[bugs] duplicate count failed", error);
    }
  }
  const duplicatesHref = (() => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const v = Array.isArray(value) ? value[0] : value;
      if (v && key !== DUPLICATES_PARAM && key !== "page") next.set(key, v);
    }
    if (!showDuplicates) next.set(DUPLICATES_PARAM, SHOW_DUPLICATES);
    const qs = next.toString();
    return qs ? `/issues?${qs}` : "/issues";
  })();

  const pagination = calculatePagination({
    page: pageParam,
    totalCount,
  });

  // Select only what the list shows: no `description` (up to 5000 chars
  // each), which the list never displays (#217).
  const listed = await prisma.bug
    .findMany({
      where,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        severity: true,
        voteCount: true,
        isDeleted: true,
        isBoosted: true,
        duplicateOf: showDuplicates ? { select: { number: true } } : false,
        createdAt: true,
        updatedAt: true,
        type: { select: { name: true } },
        reporter: { select: { name: true, role: true, image: true } },
        assignee: { select: { name: true, role: true, image: true } },
        category: { select: { id: true, name: true } },
        area: { select: { id: true, name: true } },
        votes: userId
          ? { where: { userId }, select: { id: true, value: true }, take: 1 }
          : false,
        _count: {
          select: {
            comments: true,
            attachments: true,
          },
        },
      },
      // A personal list reads newest-activity-first; boosts are for the shared one.
      orderBy: getBugOrderBy(currentSort, { boostFirst: !isWatchingView }),
      skip: pagination.skip,
      take: pagination.take,
    })
    .then((bugs) => ({ bugs }))
    .catch((error: unknown) => ({ reference: logLoadFailure("[bugs] list query failed", error) }));
  if ("reference" in listed) {
    return issuesQueryError(listed.reference);
  }
  const bugs = listed.bugs;

  // #301: when searching, show why a row matched. Only rows whose title
  // doesn't already contain the query need their description, so the list
  // query still never selects it (#217) and a search whose hits are all in
  // titles costs nothing extra. No search → no query at all.
  const searchText = qParam?.trim() ?? "";
  const snippets = new Map<string, Snippet>();
  if (searchText) {
    const needDescription = bugs
      .filter((bug) => !hasMatch(bug.title, searchText))
      .map((bug) => bug.id);
    if (needDescription.length > 0) {
      try {
        const rows = await prisma.bug.findMany({
          where: { id: { in: needDescription } },
          select: { id: true, description: true },
        });
        for (const row of rows) {
          const snippet = matchSnippet(markdownToPlain(row.description), searchText);
          if (snippet) snippets.set(row.id, snippet);
        }
      } catch (error) {
        // A snippet is a nicety; the results themselves are already loaded.
        console.error("[bugs] search snippets failed", error);
      }
    }
  }

  const bugIds = bugs.map((bug) => bug.id);

  // #289: filtering on one milestone shows its progress above the list.
  let milestoneSummary: Awaited<ReturnType<typeof loadMilestoneSummaries>>[number] | null = null;
  if (selectedMilestone && selectedMilestone !== "none") {
    try {
      [milestoneSummary] = await loadMilestoneSummaries({
        id: selectedMilestone.id,
        tenantId: tenantId ?? undefined,
      });
    } catch (error) {
      console.error("[bugs] milestone summary failed", error);
    }
  }

  // "No issues match" and "there are no issues yet" need different pages
  // (#292): filter advice on an empty tracker sends people looking for a
  // filter that is not there. The extra count only runs when the page is
  // already empty, so a populated list pays nothing for it. It counts the
  // project the list shows, so a new project in a busy workspace is "no
  // issues yet" too, not "no issues match".
  let isFirstRun = false;
  if (totalCount === 0 && !isDeletedView) {
    try {
      isFirstRun = (await prisma.bug.count({
        where: { ...bugInTenant(tenantId), ...(projectId ? { projectId } : {}), isDeleted: false },
      })) === 0;
    } catch {
      isFirstRun = false;
    }
  }

  // Only the watching view offers "stop watching the finished ones", and
  // only when there are some; everyone else pays for nothing (#312).
  let finishedWatched = 0;
  if (isWatchingView && userId) {
    try {
      finishedWatched = await prisma.bug.count({
        where: { ...finishedWatchedWhere(userId), ...bugInTenant(tenantId) },
      });
    } catch (error) {
      console.error("[bugs] finished watched count failed", error);
    }
  }

  // Only admins get bulk actions. The type and platform menus reuse the
  // lookups above, which already survived a missing table. The assignee
  // query is the one extra read, and it must not take the list down either.
  const bulkTypes = canDelete ? activeBulkOptions(tagTypes) : [];
  const bulkPlatforms = canDelete ? activeBulkOptions(platforms) : [];
  const bulkUsers = canDelete ? await loadBulkAssignees(tenantId) : [];

  let voterSummaries = new Map<string, ReturnType<typeof createEmptyVoterSummary>>();
  try {
    voterSummaries = await fetchVoterSummaries(bugIds);
  } catch (error) {
    console.error("[bugs] voter summaries failed", error);
    voterSummaries = new Map();
  }

  // The key is the current query string, so changing a filter or a page
  // remounts the provider and clears the selection — which is what the bar
  // tells the user will happen.
  const selectionKey = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => {
      const single = toSingleQueryParam(v);
      return single ? [[k, single] as [string, string]] : [];
    }),
  ).toString();

  const reportedCount = [...stages.values()].filter((stage) => stage === "reported").length;
  const confirmedCount = [...stages.values()].filter((stage) => stage === "confirmed").length;
  const readyCount = [...stages.values()].filter((stage) => stage === "ready").length;
  const stageClass: Record<IssueStage, string> = {
    reported: "bg-slate-100 text-slate-700",
    confirmed: "bg-amber-50 text-amber-900",
    ready: "bg-emerald-50 text-emerald-800",
  };

  const severityDotColors: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-emerald-500",
  };

  // #1056: one centred column, a simple list going down; no stats card.
  const page = (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {gettingStarted ? <GettingStarted {...gettingStarted} /> : null}
      {activeProject?.goal ? (
        <section aria-labelledby="project-goal-heading" className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="project-goal-heading" className="text-sm font-semibold text-slate-900">{activeProject.name} goal</h2>
            {membershipRole && isOrganizationAdmin(membershipRole, effectiveRole) ? (
              <Link href={`/projects/${encodeURIComponent(activeProject.slug)}/settings`} className="text-xs font-medium text-teal-800 underline">Edit project settings</Link>
            ) : null}
          </div>
          <RichText content={activeProject.goal} className="mt-1 text-sm" />
        </section>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1
              className={
                isDeletedView
                  ? "text-xl sm:text-2xl font-bold tracking-tight text-slate-900"
                  : "text-2xl sm:text-3xl font-bold tracking-tight text-slate-900"
              }
            >
              {/* #1063: the project is the heading; "Ziki" is in the header. */}
              {isDeletedView ? "Deleted Issues" : (activeProject?.name ?? "Issues")}
            </h1>
            {isDeletedView ? (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                Admin view
              </span>
            ) : null}
          </div>
          {isDeletedView ? null : (
            <p className="mt-1 max-w-xl text-sm font-normal text-slate-600">
              A report stays an idea until reviewers accept it and three people upvote it. Then it is an issue and can be passed on.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {canDelete ? (
            <Link
              href={isDeletedView ? "/issues" : "/issues?deleted=true"}
              className={`inline-flex h-9 items-center justify-center rounded-full px-3.5 text-sm font-medium border transition ${
                isDeletedView
                  ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              }`}
            >
              {isDeletedView ? "← View active issues" : "View deleted issues"}
            </Link>
          ) : null}
          {finishedWatched > 0 ? <UnwatchFinishedButton count={finishedWatched} /> : null}
          {/* #1057: "New issue" lives in the header on every page; no second one here. */}
        </div>
      </div>

      {/* #1054: no sidebar. Reported / Confirmed are a Stage filter now. */}
      <div className="space-y-4">
        {isFirstRun ? null : (
          <PlatformTabs
            tabs={platformTabs}
            current={isResolvedView ? "resolved" : selectedPlatform}
            hrefFor={platformHref}
          />
        )}
        {isFirstRun ? null : (
          <Suspense
            fallback={<div className="h-12 animate-pulse rounded-lg bg-slate-100" />}
          >
            <IssueFilters
              tagTypes={tagTypes}
              platforms={platforms}
              milestones={milestones}
              areas={areas}
              shortcutsEnabled={shortcutsEnabled}
              stageCounts={isDeletedView ? undefined : { reported: reportedCount, confirmed: confirmedCount, ready: readyCount }}
            />
          </Suspense>
        )}

          <div className="flex items-center justify-between text-xs text-slate-500">
            {/* #690: announce the result count so screen readers hear
                "N results" after a search lands. */}
            <p role="status" aria-live="polite">
              {resultCountText(totalCount, statusWhere !== undefined ? statusParam ?? null : null)} · sorted by{" "}
              {bugSortDescriptions[currentSort]}
              {hiddenResolved > 0 || (showResolved && statusWhere === undefined && !isDeletedView) ? (
                <>
                  {" · "}
                  <Link href={resolvedHref} className="font-medium text-blue-600 hover:underline print:hidden">
                    {showResolved ? "Hide resolved" : `Show ${hiddenResolved} resolved`}
                  </Link>
                </>
              ) : null}
              {hiddenDuplicates > 0 || showDuplicates ? (
                <>
                  {" · "}
                  <Link href={duplicatesHref} className="font-medium text-blue-600 hover:underline print:hidden">
                    {showDuplicates
                      ? "Hide duplicates"
                      : `Show ${hiddenDuplicates} duplicate${hiddenDuplicates === 1 ? "" : "s"}`}
                  </Link>
                </>
              ) : null}
            </p>
          </div>

          {milestoneSummary ? (
            <section
              aria-label={`Milestone ${milestoneSummary.title}`}
              className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">{milestoneSummary.title}</h2>
                <MilestoneDue due={dueDateValue(milestoneSummary.dueDate) || null} isClosed={milestoneSummary.isClosed} />
                <Link href="/milestones" className="ml-auto text-sm text-blue-600 hover:underline">
                  All milestones
                </Link>
              </div>
              {milestoneSummary.description ? (
                <p className="mt-1 text-sm text-slate-600">{milestoneSummary.description}</p>
              ) : null}
              <div className="mt-3 max-w-md">
                <MilestoneProgressBar progress={milestoneSummary.progress} label={milestoneSummary.title} />
              </div>
            </section>
          ) : null}

          {isFirstRun ? (
            <FirstRunWelcome isAdmin={canDelete} hasTenant={Boolean(tenantId)} />
          ) : bugs.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-5">
              <p className="text-sm font-medium text-slate-800">
                {isWatchingView && !qParam && !statusParam && !severityParam && !tagsParam && !selectedPlatform && !selectedMilestone
                  ? "You're not watching any issues."
                  : "No issues match these filters."}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {isWatchingView
                  ? "You watch issues you report, are assigned to or comment on, and any you choose to watch from the issue page."
                  : "Try clearing filters, or report it with New issue at the top."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Link
                  href="/issues"
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  Clear filters
                </Link>
              </div>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {bugs.map((bug) => {
                  const userVote =
                    Array.isArray(bug.votes) && bug.votes.length > 0
                      ? (bug.votes[0].value ?? 1)
                      : 0;
                  const voterSummary =
                    voterSummaries.get(bug.id) ?? createEmptyVoterSummary();
                  const stage = stages.get(bug.id);

                  // Priority order: severity and status answer "how urgent /
                  // where is it" and type says what it is, so those three stay
                  // visible; category and area fold into the +N chip (#686).
                  const pills: RowPill[] = [
                    {
                      name: severityLabels[bug.severity],
                      className: "border-slate-200 bg-white text-slate-700",
                      content: (
                        <>
                          <span
                            className={`mr-1.5 h-2 w-2 rounded-full shrink-0 ${
                              severityDotColors[bug.severity] ?? "bg-slate-400"
                            }`}
                          />
                          {severityLabels[bug.severity]}
                        </>
                      ),
                    },
                    {
                      name: statusLabels[bug.status],
                      className: `border-transparent ${statusClass[bug.status]}`,
                      content: (
                        <>
                          {isDone(bug.status) ? (
                            <svg
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className="mr-1 h-3 w-3"
                              aria-hidden="true"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                                clipRule="evenodd"
                              />
                            </svg>
                          ) : null}
                          {statusLabels[bug.status]}
                        </>
                      ),
                    },
                    ...(bug.type
                      ? [
                          {
                            name: bug.type.name,
                            className: getIssueTypeBadgeClass(bug.type.name),
                          },
                        ]
                      : []),
                    ...(bug.category
                      ? [
                          {
                            name: bug.category.name,
                            className:
                              "border-slate-200 bg-slate-100 text-slate-700",
                          },
                        ]
                      : []),
                    ...(bug.area
                      ? [
                          {
                            name: bug.area.name,
                            className: "border-teal-200 bg-teal-50 text-teal-900",
                          },
                        ]
                      : []),
                    ...(bug.isDeleted
                      ? [
                          {
                            name: "Deleted",
                            className:
                              "border-red-300 bg-red-100 text-red-900 font-semibold",
                            content: "🗑️ Deleted",
                          },
                        ]
                      : []),
                    ...(bug.duplicateOf
                      ? [
                          {
                            name: `Duplicate of ${formatIssueNumber(bug.duplicateOf.number)}`,
                            className: "border-amber-300 bg-amber-50 text-amber-900",
                          },
                        ]
                      : []),
                  ];
                  return (
                    <li
                      key={bug.id}
                      className="group flex flex-wrap items-start gap-3.5 p-3.5 sm:p-4 md:flex-nowrap transition hover:bg-slate-50/80 has-[a[data-issue-link]:focus-visible]:bg-blue-50/60"
                    >
                      {canDelete && !isDeletedView ? (
                        <div className="pt-1">
                          <BulkCheckbox id={bug.id} title={bug.title} />
                        </div>
                      ) : null}
                      <div className="shrink-0 pt-0.5">
                        <VoteButton
                          bugId={bug.id}
                          voteCount={bug.voteCount}
                          userVote={userVote}
                          likeCount={voterSummary.likes.count}
                          size="sm"
                          readOnly={isDeletedView}
                        />
                      </div>
                      <Link
                        href={`/issues/${bug.id}`}
                        data-issue-link=""
                        className="min-w-0 flex-1 basis-0 rounded-md scroll-my-24 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
                      >
                        <div className="flex flex-col gap-2">
                          <div className="min-w-0 space-y-1">
                            <p
                              className={`font-semibold text-base break-words transition-colors group-hover:text-blue-600 ${
                                isDone(bug.status) ? "text-slate-500" : "text-slate-900"
                              }`}
                            >
                              <span className="font-mono text-xs font-semibold text-slate-600 mr-2 tabular-nums">
                                {formatIssueNumber(bug.number)}
                              </span>
                              {searchText ? (
                                <Highlighted segments={highlightSegments(bug.title, searchText)} />
                              ) : (
                                bug.title
                              )}
                            </p>
                            {snippets.has(bug.id) ? (
                              <SearchSnippet snippet={snippets.get(bug.id)!} />
                            ) : null}

                            {/* One muted line: taxonomy on the left in ≤3 pills
                                (+N), then the metadata a triager scans for.
                                Nothing here outranks the title (#686). */}
                            <IssueRowMeta
                              pills={pills}
                              meta={
                                <>
                                  {stage ? (
                                    <>
                                      <span
                                        title={intakeDetail(stage, bug.voteCount)}
                                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageClass[stage]}`}
                                      >
                                        {intakeLabel(stage)}
                                      </span>
                                      <MetaSeparator />
                                    </>
                                  ) : null}
                                  <RowAge
                                    date={currentSort === "newest" ? bug.createdAt : bug.updatedAt}
                                    sort={currentSort === "newest" ? "newest" : "updated"}
                                  />
                                  {(bug._count?.comments ?? 0) > 0 ? (
                                    <>
                                      <MetaSeparator />
                                      <span
                                        title={`Conversation: ${bug._count?.comments} item${bug._count?.comments === 1 ? "" : "s"}`}
                                      >
                                        💬 {bug._count?.comments}
                                      </span>
                                    </>
                                  ) : null}
                                  {(bug._count?.attachments ?? 0) > 0 ? (
                                    <>
                                      <MetaSeparator />
                                      <span title={`${bug._count?.attachments} attachments`}>
                                        📎 {bug._count?.attachments}
                                      </span>
                                    </>
                                  ) : null}
                                </>
                              }
                            />

                            {/* #1060: the vote count lives in the vote button only;
                                who voted is on the issue page. */}
                          </div>
                        </div>
                      </Link>

                      {/* #1061: the assignee's face, at the right of the row on every width. */}
                      {bug.assignee ? (
                        <div className="shrink-0 self-start pt-0.5">
                          <RowAssignee name={bug.assignee.name} image={bug.assignee.image} />
                        </div>
                      ) : null}

                      <div className="flex w-full basis-full shrink-0 items-center justify-end gap-3 self-center border-t border-slate-100 pt-2 empty:hidden md:basis-auto md:w-auto md:border-0 md:pt-0 md:pl-2">
                        {isWatchingView ? (
                          <div className="flex items-center gap-2">
                            {isWatchingView && !bug.isDeleted ? (
                              <UnwatchButton
                                bugId={bug.id}
                                label={`${formatIssueNumber(bug.number)} ${bug.title}`}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <PaginationControls
                page={pagination.page}
                totalPages={pagination.totalPages}
                totalCount={totalCount}
                from={pagination.from}
                to={pagination.to}
                queryParams={issueListPaginationParams({
                  status: statusParam,
                  severity: severityParam,
                  mine: mineFilter,
                  q: qParam,
                  sort: sortParam,
                  milestone: milestoneParam,
                  tags: tagsParam,
                  platform: selectedPlatform,
                  area: selectedArea,
                  stage: stageView,
                  deleted: isDeletedView,
                  showDuplicates,
                  showResolved,
                })}
              />
            </>
          )}
      </div>
    </div>
  );

  if (!canDelete || isDeletedView) return page;

  return (
    <BulkSelectionProvider
      key={selectionKey}
      pageIds={bugIds}
      types={bulkTypes}
      platforms={bulkPlatforms}
      users={bulkUsers}
    >
      {page}
    </BulkSelectionProvider>
  );
}

/** What a brand-new tracker shows instead of an empty list (#292, #444). */
function FirstRunWelcome({
  isAdmin,
  hasTenant = true,
}: {
  isAdmin: boolean;
  hasTenant?: boolean;
}) {
  if (!hasTenant) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-5">
        <h2 className="text-lg font-semibold text-slate-900">No workspace yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          You are not currently a member of any workspace. Join a workspace via an invite from your team,
          or create your own workspace to start filing issues.
        </p>
        <div className="mt-5">
          <Link
            href="/tenants"
            className="inline-flex h-9 items-center justify-center rounded-full bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800"
          >
            Create or join a workspace
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-5">
      <h2 className="text-lg font-semibold text-slate-900">No issues yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
        This is where reported issues will appear. A good report says what you
        expected, what happened instead, and how to make it happen again.
      </p>
      <div className="mt-5">
        <Link
          href="/issues/new"
          className="inline-flex h-9 items-center justify-center rounded-full bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800"
        >
          Report the first issue
        </Link>
      </div>
      {isAdmin ? (
        <p className="mx-auto mt-6 max-w-md text-sm text-slate-600">
          Before people start reporting, you may want to set up your{" "}
          <Link href="/projects" className="font-medium text-teal-700 underline">
            projects
          </Link>
          , and the{" "}
          <Link href="/admin/categories" className="font-medium text-teal-700 underline">
            platforms
          </Link>{" "}
          and{" "}
          <Link href="/admin/types" className="font-medium text-teal-700 underline">
            issue types
          </Link>{" "}
          they will choose from.
        </p>
      ) : null}
    </section>
  );
}

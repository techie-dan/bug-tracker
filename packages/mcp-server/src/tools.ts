import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RequestSpec } from "./client.js";

/**
 * One tool per agent API route. The zod shape is the single source for both
 * the MCP input schema and the tool's description, so the assistant sees the
 * same fields, limits and enums the route enforces. tools.test.ts checks that
 * every route here exists in app/api/v1 and in docs/ziki-for-agents.md.
 */
export type ToolDef = {
  name: string;
  /** What the tool does and when to use it. */
  summary: string;
  /** Minimum agent level the route needs (see docs/ziki-for-agents.md). */
  level: "observer" | "contributor" | "reviewer" | "merger";
  method: RequestSpec["method"];
  /** Route under /api/v1; `{x}` segments are filled from the input field `x`. */
  route: string;
  input: z.ZodRawShape;
  /** Input fields sent as query parameters. */
  query?: readonly string[];
  /** Input fields sent in the JSON body. */
  body?: readonly string[];
  /** HTTP headers filled from input fields: `{ "Header-Name": "inputField" }`. */
  headers?: Readonly<Record<string, string>>;
  /** Adds `projectId` (input, else the paired project) to the query. */
  projectScoped?: boolean;
  /** Send these input fields as a multipart `file` upload instead of JSON. */
  file?: { filename: string; data: string };
  /** Input field that limits how long a streaming response stays open. Not sent to the API. */
  streamSeconds?: string;
};

const projectId = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Project id. Defaults to the project this key was paired with.");

const issueId = z.string().trim().min(1).max(191).describe("Issue id (the `id` field, not the #number).");

const idempotencyKey = z
  .string()
  .trim()
  .min(1)
  .max(191)
  .optional()
  .describe("Unique key for this action, sent as the Idempotency-Key header. Reuse the same key when retrying so it is not applied twice. Generated if omitted.");

const cursor = z.string().optional().describe("Opaque cursor from a previous response.");
const wait = z.number().int().min(0).max(25).optional().describe("Long-poll seconds (0-25); returns as soon as something new arrives.");

export const TOOLS: readonly ToolDef[] = [
  {
    name: "ziki_whoami",
    summary: "Confirm the key works and read this agent's identity, level and the projects it can see.",
    level: "observer",
    method: "GET",
    route: "/agents/me",
    input: {},
  },
  {
    name: "ziki_list_projects",
    summary: "List the projects in this agent's tenant, to find a projectId.",
    level: "observer",
    method: "GET",
    route: "/projects",
    input: {},
  },
  {
    name: "ziki_list_issues",
    summary:
      "List issues in a project, newest first. Page with `nextCursor`. Use `stage` for the intake queue: reported, confirmed, or ready.",
    level: "observer",
    method: "GET",
    route: "/issues",
    projectScoped: true,
    query: ["status", "severity", "assignee", "platform", "area", "stage", "limit", "cursor"],
    input: {
      projectId,
      status: z.enum(["open", "in_progress", "resolved", "closed"]).optional().describe("Only issues in this status."),
      severity: z.enum(["low", "medium", "high", "critical"]).optional().describe("Only issues of this severity."),
      assignee: z.string().optional().describe("An assignee's user id, or `none` for unassigned issues."),
      platform: z.string().optional().describe("A platform (category) id, or `none` for issues with no platform."),
      area: z.string().optional().describe("A project area id, or `none` for issues without an area."),
      stage: z
        .enum(["reported", "confirmed", "ready"])
        .optional()
        .describe(
          "Intake stage of an open issue. reported: not yet confirmed. confirmed: two independent accepts and fewer than three upvotes. ready: confirmed and at least three upvotes, so the work can be taken. Issues that are no longer open have no stage.",
        ),
      limit: z.number().int().min(1).max(100).optional().describe("Page size (default 25, maximum 100)."),
      cursor,
    },
  },
  {
    name: "ziki_get_issue",
    summary: "Read one issue, with its claim state and the latest 100 comments.",
    level: "observer",
    method: "GET",
    route: "/issues/{id}",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_create_issue",
    summary:
      "File a new issue on behalf of the owner. Severity is set later by independent reviewers, not by you. Check for a duplicate with ziki_list_issues first.",
    level: "contributor",
    method: "POST",
    route: "/issues",
    projectScoped: true,
    body: ["title", "description", "categoryId", "areaId", "proofLinks", "attachmentIds"],
    headers: { "Idempotency-Key": "idempotencyKey" },
    input: {
      idempotencyKey,
      projectId,
      title: z.string().trim().min(3).max(200).describe("Short title, 3-200 characters."),
      description: z
        .string()
        .trim()
        .min(10)
        .max(5000)
        .describe("Markdown description, 10-5000 characters: steps to reproduce, expected and actual result."),
      categoryId: z.string().optional().describe("Platform (category) id."),
      areaId: z.string().optional().describe("Project area id (for example front end or back end)."),
      proofLinks: z
        .string()
        .optional()
        .describe("GitHub issue or pull request URLs related to this issue, one per line."),
      attachmentIds: z.array(z.string()).max(5).optional().describe("Up to 5 attachment ids already uploaded to Ziki."),
    },
  },
  {
    name: "ziki_list_comments",
    summary: "Read an issue's comments from the start, for threads longer than the 100 shown by ziki_get_issue.",
    level: "observer",
    method: "GET",
    route: "/issues/{id}/comments",
    projectScoped: true,
    query: ["cursor"],
    input: { id: issueId, projectId, cursor },
  },
  {
    name: "ziki_comment",
    summary: "Comment on an issue as the owner's agent. Use `type` for structured updates such as a delivery.",
    level: "contributor",
    method: "POST",
    route: "/issues/{id}/comments",
    projectScoped: true,
    body: ["body", "parentId", "type", "metadata", "attachmentIds"],
    input: {
      id: issueId,
      projectId,
      body: z.string().trim().min(1).max(2000).describe("Comment text, 1-2000 characters."),
      parentId: z.string().optional().describe("Id of the comment this replies to."),
      type: z
        .enum(["comment", "bid", "review", "delivery", "request_to_merge"])
        .optional()
        .describe("Comment type (default `comment`)."),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Structured details, for example `prUrl`, `commit`, `eta` or `verdict`."),
      attachmentIds: z.array(z.string()).max(5).optional().describe("Up to 5 attachment ids already uploaded to Ziki."),
    },
  },
  {
    name: "ziki_read_inbox",
    summary:
      "Read items addressed to this agent: offers, replies, mentions, answers from the owner, approvals and released claims. Oldest first.",
    level: "observer",
    method: "GET",
    route: "/inbox",
    query: ["after", "wait", "unread"],
    input: {
      after: z.string().optional().describe("`cursor` from a previous inbox response."),
      wait,
      unread: z.boolean().optional().describe("Only unread items."),
    },
  },
  {
    name: "ziki_mark_inbox_read",
    summary: "Mark inbox items read, by id or everything up to one item.",
    level: "observer",
    method: "POST",
    route: "/inbox/read",
    body: ["ids", "upTo"],
    input: {
      ids: z.array(z.string()).min(1).max(500).optional().describe("Inbox item ids. Use this or `upTo`, not both."),
      upTo: z.string().optional().describe("Mark this item and everything before it read."),
    },
  },
  {
    name: "ziki_volunteer",
    summary:
      "Volunteer (bid) for an issue. A report is still an idea until reviewers accept it and it has at least three upvotes. A bid does not assign it: the reporter or an admin awards one. Ask the owner first.",
    level: "contributor",
    method: "POST",
    route: "/issues/{id}/bid",
    projectScoped: true,
    body: ["note"],
    input: {
      id: issueId,
      projectId,
      note: z.string().max(280).optional().describe("Short reason, at most 280 characters."),
    },
  },
  {
    name: "ziki_withdraw_bid",
    summary: "Withdraw this agent's open bid on an issue.",
    level: "contributor",
    method: "DELETE",
    route: "/issues/{id}/bid",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_request_offer",
    summary:
      "Ask for an offer on a ready issue. The server picks the next eligible person; the offer lasts 60 seconds, so accept it straight away.",
    level: "contributor",
    method: "POST",
    route: "/issues/{id}/offer",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_accept_offer",
    summary:
      "Accept an offer (a `claim.offered` inbox item) to turn it into the active claim. Starts the delivery deadline. 410 means it expired.",
    level: "contributor",
    method: "POST",
    route: "/offers/{id}/accept",
    input: { id: z.string().trim().min(1).describe("The offer's claim id.") },
  },
  {
    name: "ziki_heartbeat",
    summary:
      "Keep an active claim alive. Send at least every few minutes while working; a claim silent for 15 minutes is released.",
    level: "contributor",
    method: "POST",
    route: "/issues/{id}/heartbeat",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_extend_deadline",
    summary: "Spend the claim's one extension to move the delivery deadline.",
    level: "contributor",
    method: "POST",
    route: "/issues/{id}/extend",
    projectScoped: true,
    body: ["reason"],
    input: {
      id: issueId,
      projectId,
      reason: z.string().trim().min(1).max(500).describe("Why more time is needed, at most 500 characters."),
    },
  },
  {
    name: "ziki_link_pull_request",
    summary: "Link the GitHub pull request that fixes an issue. If the fix is already accepted, Ziki also tries to merge it.",
    level: "contributor",
    method: "POST",
    route: "/issues/{id}/github",
    projectScoped: true,
    body: ["pullRequestUrl"],
    input: {
      id: issueId,
      projectId,
      pullRequestUrl: z.string().trim().min(1).max(2048).describe("https://github.com/<owner>/<repo>/pull/<number>"),
    },
  },
  {
    name: "ziki_validate_issue",
    summary:
      "Give an independent verdict on a bug or fix. Your owner must not be the reporter or creator's owner. Two accepts confirm an issue.",
    level: "reviewer",
    method: "POST",
    route: "/issues/{id}/validations",
    projectScoped: true,
    body: ["kind", "verdict", "severity", "duplicateOfId", "notes", "onBehalfOfUserId"],
    input: {
      id: issueId,
      projectId,
      kind: z
        .enum(["real", "format", "duplicate", "fix"])
        .describe("What you are judging: `real` (is it a genuine bug), `format` (is it well written), `duplicate`, or `fix`."),
      verdict: z.enum(["accept", "reject"]).describe("accept or reject."),
      severity: z
        .enum(["low", "medium", "high", "critical"])
        .optional()
        .describe("Required when accepting `real`, and only allowed then. Severity can only be raised by reviewers."),
      duplicateOfId: z.string().optional().describe("For a duplicate verdict: the canonical issue id."),
      notes: z.string().trim().max(2000).optional().describe("Optional notes, at most 2000 characters."),
      onBehalfOfUserId: z.string().optional().describe("Defaults to the agent's owner."),
    },
  },
  {
    name: "ziki_submit_test_result",
    summary:
      "Submit a test verdict for the issue's linked pull request. Reporting again replaces your earlier verdict until the fix is accepted.",
    level: "reviewer",
    method: "POST",
    route: "/issues/{id}/test-results",
    projectScoped: true,
    body: ["goodToMerge", "notes", "onBehalfOfUserId", "headSha"],
    input: {
      id: issueId,
      projectId,
      goodToMerge: z.boolean().describe("true if the fix is good to merge."),
      notes: z.string().trim().max(2000).optional().describe("What you tested and where, at most 2000 characters."),
      onBehalfOfUserId: z.string().optional().describe("Defaults to the agent's owner."),
      headSha: z
        .string()
        .trim()
        .regex(/^[0-9a-f]{7,64}$/i, "headSha must be a hexadecimal commit SHA.")
        .optional()
        .describe(
          "The commit you tested (7-64 hex characters). Defaults to the SHA recorded when the pull request was linked.",
        ),
    },
  },
  {
    name: "ziki_ask_owner",
    summary: "Ask the owner a question, optionally about an issue. Read the answer with ziki_get_question or the inbox.",
    level: "contributor",
    method: "POST",
    route: "/questions",
    body: ["body", "bugId", "type"],
    input: {
      body: z.string().trim().min(3).max(2000).describe("The question, 3-2000 characters."),
      bugId: z.string().optional().describe("The issue this is about."),
      type: z
        .enum(["question", "work_authorization", "blocker", "scope_change", "human_approval"])
        .optional()
        .describe("What kind of ask this is (default `question`)."),
    },
  },
  {
    name: "ziki_get_question",
    summary: "Read a question this agent asked and, once the owner has answered, the answer.",
    level: "observer",
    method: "GET",
    route: "/questions/{id}",
    input: { id: z.string().trim().min(1).describe("Question id.") },
  },
  {
    name: "ziki_pair",
    summary: "Start pairing another agent. Show the owner the user code and wait for approval. The pairing route ignores the key this server already has.",
    level: "observer",
    method: "POST",
    route: "/agents/pairing",
    body: ["name", "model"],
    input: {
      name: z.string().trim().min(2).max(60).describe("Name the owner will approve, 2-60 characters."),
      model: z.string().trim().min(1).max(40).optional().describe("Model name, at most 40 characters."),
    },
  },
  {
    name: "ziki_collect_pairing_token",
    summary: "Collect the key for a pairing once the owner has approved. authorization_pending means keep waiting.",
    level: "observer",
    method: "POST",
    route: "/agents/pairing/token",
    body: ["device_code"],
    input: {
      device_code: z.string().trim().min(1).describe("device_code from ziki_pair."),
    },
  },
  {
    name: "ziki_get_points",
    summary: "Read this agent's owner's point balance. from and to are inclusive ISO-8601 bounds.",
    level: "observer",
    method: "GET",
    route: "/agents/me/points",
    query: ["from", "to"],
    input: {
      from: z.string().optional().describe("Inclusive start, ISO-8601."),
      to: z.string().optional().describe("Inclusive end, ISO-8601. Must not be before from."),
    },
  },
  {
    name: "ziki_rotate_key",
    summary: "Replace this agent's API key. The old key stops working immediately. Store the new key and restart this server with it.",
    level: "observer",
    method: "POST",
    route: "/agents/me/key",
    input: {},
  },
  {
    name: "ziki_get_project",
    summary: "Read one project, including its workflow gates and reward rules.",
    level: "observer",
    method: "GET",
    route: "/projects/{id}",
    input: { id: z.string().trim().min(1).describe("Project id.") },
  },
  {
    name: "ziki_read_feed",
    summary: "Read the project feed, oldest unsent issues first. Page with after and afterId together.",
    level: "observer",
    method: "GET",
    route: "/feed",
    projectScoped: true,
    query: ["after", "afterId", "area"],
    input: {
      projectId,
      after: z.string().optional().describe("ISO timestamp of the last issue you have seen."),
      afterId: z.string().optional().describe("Id tie-breaker for after. Send both or neither."),
      area: z.string().optional().describe("A project area id, or none."),
    },
  },
  {
    name: "ziki_poll_events",
    summary: "Poll tenant events, oldest first. Pass the returned cursor as after on the next call.",
    level: "observer",
    method: "GET",
    route: "/events",
    query: ["after", "afterId", "wait", "types", "projectId", "bugId"],
    input: {
      after: z.string().optional().describe("Cursor from the previous response, or an ISO timestamp."),
      afterId: z.string().optional().describe("Required when after is a timestamp."),
      wait,
      types: z.string().optional().describe("Comma-separated event types or prefixes, such as claim.*."),
      projectId,
      bugId: z.string().optional().describe("Only events for this issue."),
    },
  },
  {
    name: "ziki_stream_events",
    summary: "Listen to the live event stream for a few seconds and return the text that arrived.",
    level: "observer",
    method: "GET",
    route: "/events/stream",
    streamSeconds: "seconds",
    query: ["after", "afterId", "types", "projectId", "bugId"],
    input: {
      seconds: z.number().int().min(1).max(25).optional().describe("How long to listen, in seconds (default 15, maximum 25)."),
      after: z.string().optional().describe("Cursor or ISO timestamp to replay missed events."),
      afterId: z.string().optional().describe("Tie-breaker when after is a timestamp."),
      types: z.string().optional().describe("Comma-separated event types or prefixes."),
      projectId,
      bugId: z.string().optional().describe("Only events for this issue."),
    },
  },
  {
    name: "ziki_next_mission",
    summary: "Ask for the least-recently-covered route mission in a project. Repeating this returns the current assignment.",
    level: "contributor",
    method: "POST",
    route: "/missions/next",
    projectScoped: true,
    body: ["projectId"],
    input: { projectId },
  },
  {
    name: "ziki_cover_mission",
    summary: "Report that the assigned route mission was explored.",
    level: "contributor",
    method: "POST",
    route: "/missions/{id}/covered",
    projectScoped: true,
    body: ["projectId", "issuesFiled"],
    input: {
      id: z.string().trim().min(1).describe("Mission id from ziki_next_mission."),
      projectId,
      issuesFiled: z.number().int().min(0).max(1000).describe("How many issues this run filed."),
    },
  },
  {
    name: "ziki_list_goals",
    summary: "List a project's goals and their budget summaries, newest first.",
    level: "observer",
    method: "GET",
    route: "/goals",
    projectScoped: true,
    input: { projectId },
  },
  {
    name: "ziki_create_goal",
    summary: "Create a goal. The budget pool starts unsplit.",
    level: "contributor",
    method: "POST",
    route: "/goals",
    projectScoped: true,
    body: ["title", "description", "budgetPool", "projectId"],
    input: {
      projectId,
      title: z.string().trim().min(3).max(200).describe("Goal title, 3-200 characters."),
      description: z.string().trim().max(4000).nullable().optional().describe("Up to 4000 characters. Empty or null clears it."),
      budgetPool: z.number().int().min(0).max(1_000_000_000).describe("Whole credits in the pool, from 0 to 1000000000."),
    },
  },
  {
    name: "ziki_get_goal",
    summary: "Read one goal, its budget summary, and its live allocations.",
    level: "observer",
    method: "GET",
    route: "/goals/{id}",
    projectScoped: true,
    input: { id: z.string().trim().min(1).describe("Goal id."), projectId },
  },
  {
    name: "ziki_update_goal",
    summary: "Move a goal between active, completed, and cancelled. A closed goal stops accepting splits.",
    level: "contributor",
    method: "PATCH",
    route: "/goals/{id}",
    projectScoped: true,
    body: ["status"],
    input: {
      id: z.string().trim().min(1).describe("Goal id."),
      projectId,
      status: z.enum(["active", "completed", "cancelled"]).describe("The goal's next status."),
    },
  },
  {
    name: "ziki_list_goal_allocations",
    summary: "List the live slices carved out of a goal's budget pool.",
    level: "observer",
    method: "GET",
    route: "/goals/{id}/allocations",
    projectScoped: true,
    input: { id: z.string().trim().min(1).describe("Goal id."), projectId },
  },
  {
    name: "ziki_split_goal",
    summary: "Split a goal's remaining budget across issues, nested goals, or agent deliverables. The same sourceKey is never applied twice.",
    level: "contributor",
    method: "POST",
    route: "/goals/{id}/allocations",
    projectScoped: true,
    body: ["method", "amount", "sourceKey", "targets", "projectId"],
    input: {
      id: z.string().trim().min(1).describe("Goal id."),
      projectId,
      method: z.enum(["manual", "proportional", "milestone", "even"]).describe("How each slice is computed."),
      amount: z.number().int().min(1).optional().describe("Total credits to carve out. Omit to use everything still unallocated. Not used for manual."),
      sourceKey: z.string().trim().min(1).max(191).optional().describe("Idempotency key for this split."),
      targets: z
        .array(
          z.object({
            targetType: z.enum(["issue", "goal", "agent"]),
            targetBugId: z.string().optional(),
            targetGoalId: z.string().optional(),
            targetAgentId: z.string().optional(),
            label: z.string().optional(),
            weight: z.number().int().optional(),
            amount: z.number().int().optional(),
          }),
        )
        .min(1)
        .max(50)
        .describe("Slices. issue needs targetBugId. goal needs targetGoalId. agent needs label. manual needs amount on each target. proportional and milestone need weight. milestone weights total 100."),
    },
  },
  {
    name: "ziki_list_jobs",
    summary: "List a project's research jobs, newest first.",
    level: "observer",
    method: "GET",
    route: "/jobs",
    projectScoped: true,
    input: { projectId },
  },
  {
    name: "ziki_create_job",
    summary: "Create a research job. Agents submit rows and reviewers accept them.",
    level: "contributor",
    method: "POST",
    route: "/jobs",
    projectScoped: true,
    body: ["brief", "submissionSchema", "dedupeKey", "maxSubmissions", "pointsPerAccepted", "projectId"],
    input: {
      projectId,
      brief: z.string().trim().min(10).max(5000).describe("What to collect, 10-5000 characters."),
      submissionSchema: z
        .union([
          z.array(z.string().trim().min(1).max(100)).min(1).max(100),
          z.object({
            properties: z.record(z.string(), z.object({ type: z.string().optional(), description: z.string().optional() }).passthrough()),
            required: z.array(z.string()).max(100).optional(),
          }),
        ])
        .nullable()
        .optional()
        .describe("Field names, or a properties object. dedupeKey must be one of those fields when this is set."),
      dedupeKey: z.string().trim().min(1).max(100).describe("Submission field used to reject duplicate rows."),
      maxSubmissions: z.number().int().min(1).describe("How many rows the job accepts."),
      pointsPerAccepted: z.number().int().min(0).max(10_000).describe("Points for each accepted row."),
    },
  },
  {
    name: "ziki_get_job",
    summary: "Read one research job and its submissions.",
    level: "observer",
    method: "GET",
    route: "/jobs/{id}",
    input: { id: z.string().trim().min(1).describe("Job id.") },
  },
  {
    name: "ziki_submit_job",
    summary: "Add one row to a research job.",
    level: "contributor",
    method: "POST",
    route: "/jobs/{id}/submissions",
    body: ["data", "projectId"],
    input: {
      id: z.string().trim().min(1).describe("Job id."),
      projectId,
      data: z.record(z.string(), z.unknown()).describe("The submission row."),
    },
  },
  {
    name: "ziki_review_job_submission",
    summary: "Accept or reject one research-job submission.",
    level: "reviewer",
    method: "POST",
    route: "/jobs/submissions/{id}/reviews",
    body: ["verdict", "notes"],
    input: {
      id: z.string().trim().min(1).describe("Submission id."),
      verdict: z.enum(["accept", "reject"]).describe("accept or reject."),
      notes: z.string().trim().max(2000).optional().describe("Notes, at most 2000 characters."),
    },
  },
  {
    name: "ziki_accept_job_review",
    summary: "Accept an offer to review a research job.",
    level: "reviewer",
    method: "POST",
    route: "/jobs/reviews/{id}/accept",
    input: { id: z.string().trim().min(1).describe("Job review offer id.") },
  },
  {
    name: "ziki_accept_review_offer",
    summary: "Accept an offer to review an issue's fix.",
    level: "reviewer",
    method: "POST",
    route: "/reviews/{id}/accept",
    input: { id: z.string().trim().min(1).describe("Review offer id.") },
  },
  {
    name: "ziki_upload_attachment",
    summary: "Upload one screenshot, log, PDF or HAR (5 MB at most) and get an attachment id to use on an issue or comment.",
    level: "contributor",
    method: "POST",
    route: "/attachments",
    file: { filename: "filename", data: "dataBase64" },
    input: {
      filename: z.string().trim().min(1).max(240).describe("File name, including the extension."),
      dataBase64: z.string().min(1).describe("File bytes, base64 encoded."),
    },
  },
  {
    name: "ziki_list_comments_from_start",
    summary: "Read comments from the start using the conversation alias of ziki_list_comments.",
    level: "observer",
    method: "GET",
    route: "/issues/{id}/conversation",
    projectScoped: true,
    query: ["cursor"],
    input: { id: issueId, projectId, cursor },
  },
  {
    name: "ziki_list_bids",
    summary: "List open bids on an issue. A matching area is ranked first.",
    level: "observer",
    method: "GET",
    route: "/issues/{id}/bid",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_claim_issue",
    summary: "Direct claims are retired and answer 410. Take work with ziki_request_offer or ziki_volunteer instead.",
    level: "contributor",
    method: "POST",
    route: "/issues/{id}/claim",
    projectScoped: true,
    body: ["projectId", "beneficiaryUserId"],
    input: {
      id: issueId,
      projectId,
      beneficiaryUserId: z.string().optional().describe("Person who would have received the claim."),
    },
  },
  {
    name: "ziki_release_claim",
    summary: "Give back an offer or an active claim. The issue is offered to someone else.",
    level: "contributor",
    method: "POST",
    route: "/issues/{id}/release",
    projectScoped: true,
    body: ["reason"],
    input: {
      id: issueId,
      projectId,
      reason: z.string().trim().max(500).optional().describe("Why the work is being given back, at most 500 characters."),
    },
  },
  {
    name: "ziki_structure_issue",
    summary: "Fill in a report's structure: steps, expected and actual behaviour, platform and type. Can check for duplicates.",
    level: "contributor",
    method: "POST",
    route: "/issues/{id}/structure",
    projectScoped: true,
    body: ["title", "stepsToReproduce", "expectedBehavior", "actualBehavior", "environment", "description", "platform", "categoryId", "type", "typeId", "duplicateOfId", "checkDuplicates"],
    input: {
      id: issueId,
      projectId,
      title: z.string().trim().min(3).max(200).optional().describe("Replacement title."),
      stepsToReproduce: z.string().trim().optional().describe("Steps to reproduce."),
      expectedBehavior: z.string().trim().optional().describe("What should have happened."),
      actualBehavior: z.string().trim().optional().describe("What happened instead."),
      environment: z.string().trim().optional().describe("Where it happened."),
      description: z.string().trim().max(5000).optional().describe("Replacement description, at most 5000 characters."),
      platform: z.string().trim().optional().describe("Platform name used to infer a category."),
      categoryId: z.string().optional().describe("Platform (category) id."),
      type: z.string().trim().optional().describe("Issue type name."),
      typeId: z.string().optional().describe("Issue type id."),
      duplicateOfId: z.string().optional().describe("Canonical issue id when this is a duplicate."),
      checkDuplicates: z.boolean().optional().describe("Look for similar issues first. Defaults to true."),
    },
  },
  {
    name: "ziki_merge_fix",
    summary: "Accept a fix and resolve the issue. Needs a confirmed issue and enough independent good-to-merge verdicts.",
    level: "merger",
    method: "POST",
    route: "/issues/{id}/merge",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_list_interest",
    summary: "List agents who volunteered interest in an issue.",
    level: "observer",
    method: "GET",
    route: "/issues/{id}/interest",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_register_interest",
    summary: "Register interest in working a confirmed open issue. Repeating this returns the same interest.",
    level: "contributor",
    method: "POST",
    route: "/issues/{id}/interest",
    projectScoped: true,
    body: ["note"],
    input: {
      id: issueId,
      projectId,
      note: z.string().trim().max(500).optional().describe("Why you want this issue, at most 500 characters."),
    },
  },
  {
    name: "ziki_withdraw_interest",
    summary: "Withdraw this agent's interest in an issue.",
    level: "contributor",
    method: "DELETE",
    route: "/issues/{id}/interest",
    projectScoped: true,
    input: { id: issueId, projectId },
  },
  {
    name: "ziki_escalate",
    summary: "Ask the owner to unblock work. Same store as ziki_ask_owner, with an escalation type.",
    level: "contributor",
    method: "POST",
    route: "/escalations",
    body: ["body", "bugId", "type"],
    input: {
      body: z.string().trim().min(3).max(2000).describe("What you need, 3-2000 characters."),
      bugId: z.string().optional().describe("The issue this is about."),
      type: z
        .enum(["question", "work_authorization", "blocker", "scope_change", "human_approval"])
        .optional()
        .describe("What kind of ask this is."),
    },
  },
  {
    name: "ziki_get_escalation",
    summary: "Read an escalation this agent opened and, once answered, the owner's reply.",
    level: "observer",
    method: "GET",
    route: "/escalations/{id}",
    input: { id: z.string().trim().min(1).describe("Escalation id.") },
  },
  {
    name: "ziki_propose_redesign",
    summary: "Propose a redesign, optionally linked to an issue, with an HTTPS preview and up to 5 image attachments.",
    level: "contributor",
    method: "POST",
    route: "/redesigns",
    projectScoped: true,
    body: ["projectId", "onBehalfOfUserId", "bugId", "title", "body", "previewUrl", "attachmentIds"],
    input: {
      projectId,
      onBehalfOfUserId: z.string().optional().describe("Defaults to the agent's owner."),
      bugId: z.string().optional().describe("Issue this redesign is for."),
      title: z.string().trim().min(3).max(200).describe("Proposal title, 3-200 characters."),
      body: z.string().trim().min(10).max(5000).describe("Proposal, 10-5000 characters."),
      previewUrl: z.string().optional().describe("HTTPS preview URL."),
      attachmentIds: z.array(z.string()).max(5).optional().describe("Up to 5 image attachment ids."),
    },
  },
  {
    name: "ziki_list_webhooks",
    summary: "List this agent's webhook subscriptions.",
    level: "observer",
    method: "GET",
    route: "/webhooks",
    input: {},
  },
  {
    name: "ziki_create_webhook",
    summary: "Subscribe an HTTPS URL to events. The signing secret is returned once. At most three subscriptions.",
    level: "contributor",
    method: "POST",
    route: "/webhooks",
    body: ["url", "events"],
    input: {
      url: z.string().trim().url().max(2048).describe("HTTPS endpoint that will receive events."),
      events: z.array(z.string().trim().min(1).max(64)).max(50).optional().describe("Event types to deliver. Omit to receive every event."),
    },
  },
  {
    name: "ziki_delete_webhook",
    summary: "Delete one of this agent's webhook subscriptions.",
    level: "contributor",
    method: "DELETE",
    route: "/webhooks/{id}",
    input: { id: z.string().trim().min(1).describe("Webhook subscription id.") },
  },
  {
    name: "ziki_update_webhook",
    summary: "Re-enable a disabled webhook, or rotate its signing secret when rotateSecret is true.",
    level: "contributor",
    method: "PATCH",
    route: "/webhooks/{id}",
    body: ["rotateSecret"],
    input: {
      id: z.string().trim().min(1).describe("Webhook subscription id."),
      rotateSecret: z.boolean().optional().describe("true to replace the signing secret. Omit to re-enable."),
    },
  },
  {
    name: "ziki_list_webhook_deliveries",
    summary: "List recent deliveries for one webhook, newest first.",
    level: "observer",
    method: "GET",
    route: "/webhooks/{id}/deliveries",
    query: ["status", "limit", "cursor"],
    input: {
      id: z.string().trim().min(1).describe("Webhook subscription id."),
      status: z.enum(["pending", "delivered", "failed", "dead"]).optional().describe("Only deliveries in this state."),
      limit: z.number().int().min(1).max(100).optional().describe("Page size, 1-100. Default 20."),
      cursor: z.string().optional().describe("Cursor from the previous page."),
    },
  },
  {
    name: "ziki_retry_webhook_delivery",
    summary: "Queue a failed or dead webhook delivery to be sent again.",
    level: "contributor",
    method: "POST",
    route: "/webhooks/{id}/deliveries/{deliveryId}/retry",
    input: {
      id: z.string().trim().min(1).describe("Webhook subscription id."),
      deliveryId: z.string().trim().min(1).describe("Delivery id."),
    },
  },
];

/** Description shown to the assistant: what it does, the route it wraps, and the level it needs. */
export function describeTool(tool: ToolDef): string {
  return `${tool.summary} (${tool.method} /api/v1${tool.route}; needs ${tool.level} level or above.)`;
}

/** Turn validated tool input into the HTTP request for its route. */
export function buildRequest(
  tool: ToolDef,
  rawInput: Record<string, unknown>,
  defaults: { projectId: string | null },
): RequestSpec {
  const input = z.object(tool.input).parse(rawInput);
  const values = input as Record<string, unknown>;

  const path = tool.route.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(values[key])));

  const query: NonNullable<RequestSpec["query"]> = {};
  for (const key of tool.query ?? []) {
    const value = values[key];
    if (value !== undefined) query[key] = value as string | number | boolean;
  }
  if (tool.projectScoped) {
    const project = (values.projectId as string | undefined) ?? defaults.projectId;
    if (project) query.projectId = project;
  }

  // The API rejects a POST or PATCH without a JSON body, even when there is nothing to send.
  let body: Record<string, unknown> | undefined =
    tool.file || (tool.method !== "POST" && tool.method !== "PATCH") ? undefined : {};
  if (tool.body && !tool.file) {
    body = {};
    for (const key of tool.body) {
      if (values[key] !== undefined) body[key] = values[key];
      else if (key === "projectId" && defaults.projectId) body[key] = defaults.projectId;
    }
  }

  const file = tool.file
    ? {
        filename: String(values[tool.file.filename] ?? "upload"),
        dataBase64: String(values[tool.file.data] ?? ""),
      }
    : undefined;
  const streamForSeconds = tool.streamSeconds
    ? Number(values[tool.streamSeconds] ?? 15)
    : undefined;

  let headers: Record<string, string> | undefined;
  for (const [header, key] of Object.entries(tool.headers ?? {})) {
    headers ??= {};
    headers[header] = (values[key] as string | undefined) ?? randomUUID();
  }

  return { method: tool.method, path, query, body, headers, file, streamForSeconds };
}

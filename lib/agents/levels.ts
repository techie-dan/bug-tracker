import type { AgentLevel } from "@prisma/client";

/**
 * What an agent may do (#427). Each level includes everything below it.
 * Routes check their own level with `hasLevel` or `requireLevel`; this module
 * only defines the ladder and who may move an agent along it.
 */
export const AGENT_LEVELS = ["observer", "contributor", "triager", "reviewer", "merger", "dispatcher"] as const satisfies readonly AgentLevel[];

export const AGENT_LEVEL_LABELS: Record<AgentLevel, string> = {
  observer: "Observer",
  contributor: "Contributor",
  triager: "Triager",
  reviewer: "Reviewer",
  merger: "Merger",
  dispatcher: "Dispatcher",
};

export const AGENT_LEVEL_DESCRIPTIONS: Record<AgentLevel, string> = {
  observer: "List and read issues, and poll the feed.",
  contributor: "Observer, plus create issues, comment, and bid for tasks.",
  triager: "Contributor, plus clear new issues as not-duplicates or flag them as duplicates.",
  reviewer: "Triager, plus validate issues and submit test verdicts.",
  merger: "Reviewer, plus accept a fix once the validation rules pass.",
  dispatcher: "Merger, plus automatically discover ready issues and assign work to eligible agents.",
};

/** New agents start here (19 Oct review). */
export const DEFAULT_AGENT_LEVEL = "observer" satisfies AgentLevel;

/**
 * Person-facing guidance. One key per job: a second agent of the same owner
 * is still the same person, so it is not an independent reviewer (#442).
 */
export const SEPARATE_LEVEL_AGENTS =
  "Use a separate agent for each level: an observer to read, a contributor to file and claim work, a triager to check new issues for duplicates, a reviewer to check other people's tickets, a merger to accept a fix, and a dispatcher to automatically assign work.";

export const OWNER_REVIEW_LIMIT =
  "Agents you own cannot review a ticket your other agents filed or claimed, or a ticket you filed. A second agent of yours is not an independent reviewer.";

/**
 * Levels an agent may ask for when it registers itself (#425): everything
 * except `merger`, which a tenant admin grants by hand after trust is earned.
 */
export const SELF_REGISTRATION_LEVELS = [
  "observer",
  "contributor",
  "triager",
  "reviewer",
  "dispatcher",
] as const satisfies readonly AgentLevel[];

/** What the owner may pick when creating an agent. Higher levels come later. */
export const CREATION_LEVELS = SELF_REGISTRATION_LEVELS;

export function isAgentLevel(value: unknown): value is AgentLevel {
  return typeof value === "string" && (AGENT_LEVELS as readonly string[]).includes(value);
}

/** True when `level` is `required` or higher. */
export function hasLevel(level: AgentLevel, required: AgentLevel): boolean {
  return AGENT_LEVELS.indexOf(level) >= AGENT_LEVELS.indexOf(required);
}

export class AgentLevelError extends Error {
  readonly required: AgentLevel;

  constructor(required: AgentLevel) {
    super(`This needs an agent at ${AGENT_LEVEL_LABELS[required].toLowerCase()} level or higher.`);
    this.name = "AgentLevelError";
    this.required = required;
  }
}

/** Throws `AgentLevelError` (a 403) unless the agent is at least `required`. */
export function requireLevel(agent: { level: AgentLevel }, required: AgentLevel): void {
  if (!hasLevel(agent.level, required)) throw new AgentLevelError(required);
}

/** Who is changing a level: the agent's owner, a tenant admin, or both. */
export type LevelSetter = { isOwner: boolean; isTenantAdmin: boolean };

/**
 * Levels a person may set. A tenant admin may set any level; the owner may
 * set anything but `merger`, which only admins grant (#425, #451). An agent
 * never sets its own level: no agent-key route reaches this.
 */
export function canSetLevel(setter: LevelSetter, level: AgentLevel): boolean {
  if (setter.isTenantAdmin) return true;
  return setter.isOwner && level !== "merger";
}

/** The levels `setter` may pick, for the settings page. */
export function settableLevels(setter: LevelSetter): AgentLevel[] {
  return AGENT_LEVELS.filter((level) => canSetLevel(setter, level));
}

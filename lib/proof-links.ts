/** Split optional textarea input into trimmed non-empty lines. */
export function splitProofLinkLines(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates whether a given URL is a valid GitHub URL (e.g. issues, PRs, or resources).
 * Requires http(s) protocol, a GitHub host, and an actual path.
 */
export function isGitHubUrl(value: string): boolean {
  if (/[\[\]<>"\\^|]/.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const host = url.hostname.toLowerCase();
    const isGitHubHost =
      host === "github.com" ||
      host === "www.github.com" ||
      host === "gist.github.com" ||
      host.endsWith(".github.com");

    if (!isGitHubHost) {
      return false;
    }

    const cleanPath = url.pathname.replace(/^\/+|\/+$/g, "");
    return cleanPath.length > 0;
  } catch {
    return false;
  }
}

export type GitHubResourceKind = "PR" | "issue" | "discussion";

export type GitHubResourceRef = {
  owner: string;
  repo: string;
  number: number;
  kind: GitHubResourceKind;
};

/**
 * Parses a GitHub URL pointing to an issue, pull request, or discussion.
 * Returns { owner, repo, number, kind } or null if not a parseable resource URL.
 */
export function parseGitHubResourceUrl(url: string | null | undefined): GitHubResourceRef | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }

  const host = parsed.hostname.toLowerCase();
  const isGitHubHost =
    host === "github.com" ||
    host === "www.github.com" ||
    host.endsWith(".github.com");

  if (!isGitHubHost) return null;

  const match =
    /^\/([^/]+)\/([^/]+)\/(pull|pulls|issue|issues|discussion|discussions)\/(\d+)(?:\/.*)?$/i.exec(
      parsed.pathname,
    );
  if (!match) return null;

  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  const segment = match[3].toLowerCase();
  const num = parseInt(match[4], 10);

  if (!owner || !repo || !Number.isFinite(num)) return null;

  let kind: GitHubResourceKind;
  if (segment === "pull" || segment === "pulls") {
    kind = "PR";
  } else if (segment === "issue" || segment === "issues") {
    kind = "issue";
  } else if (segment === "discussion" || segment === "discussions") {
    kind = "discussion";
  } else {
    return null;
  }

  return { owner, repo, number: num, kind };
}

/**
 * Formats a proof link URL into a compact label:
 * - Parseable GitHub issues/PRs/discussions become: `{owner}/{repo} #{number} · {kind}`
 * - Other URLs degrade to a clean, truncated URL (without protocol), never blank.
 */
export function formatProofLinkLabel(url: string, maxLength = 40): string {
  if (!url?.trim()) return "";
  const trimmed = url.trim();

  const parsedResource = parseGitHubResourceUrl(trimmed);
  if (parsedResource) {
    return `${parsedResource.owner}/${parsedResource.repo} #${parsedResource.number} · ${parsedResource.kind}`;
  }

  const clean = trimmed.replace(/^https?:\/\//i, "");
  const fallback = clean.length > 0 ? clean : trimmed;

  if (fallback.length <= maxLength) {
    return fallback;
  }

  return `${fallback.slice(0, maxLength - 1)}…`;
}

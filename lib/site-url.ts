import { BASE_PATH } from "./base-path";

const DEV_ORIGIN = BASE_PATH ? `http://localhost:3001${BASE_PATH}` : "http://localhost:3000";
const PROD_ORIGIN = BASE_PATH ? `https://contributors.zedu.chat${BASE_PATH}` : "https://ziki.dev";

function stripAuthPath(raw: string): string {
  return raw.trim().replace(/\/api\/auth\/?$/, "").replace(/\/$/, "");
}

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * App origin including basePath (e.g. https://ziki.dev).
 * Invite and notification emails use this. A production process with no public
 * URL, or with a loopback AUTH_URL left over from local setup, must not send
 * people to localhost.
 */
export function getSiteUrl(): string {
  const configured =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "";
  const cleaned = configured ? stripAuthPath(configured) : "";
  const loopbackBlocked =
    process.env.NODE_ENV === "production" &&
    process.env.SITE_URL_ALLOW_LOOPBACK !== "true" &&
    cleaned !== "" &&
    isLoopback(cleaned);
  if (cleaned && !loopbackBlocked) return cleaned;

  const published = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (published) {
    const site = stripAuthPath(published);
    if (!isLoopback(site)) return site;
  }
  if (process.env.NODE_ENV === "production") return PROD_ORIGIN;
  return DEV_ORIGIN;
}

export function absoluteUrl(path: string): string {
  const base = getSiteUrl();
  if (!path || path === "/") return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

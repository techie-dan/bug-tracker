import { NextResponse, type NextRequest } from "next/server";
import { resolveIssuesForMergedPullRequest, verifyGithubSignature } from "@/lib/github/pr-merged";

export const runtime = "nodejs";

/**
 * GitHub webhook (#474). Subscribe the repository to "Pull requests" events
 * with content type application/json and the secret in GITHUB_WEBHOOK_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const headers = { "Cache-Control": "no-store" };
  if (!secret) return NextResponse.json({ error: "GitHub webhook is not configured." }, { status: 503, headers });

  const rawBody = await request.text();
  if (!verifyGithubSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401, headers });
  }
  const event = request.headers.get("x-github-event");
  if (event === "ping") return NextResponse.json({ ok: true }, { headers });
  if (event !== "pull_request") return NextResponse.json({ ignored: true }, { status: 202, headers });

  let payload: { action?: string; pull_request?: { merged?: boolean; html_url?: string } };
  try { payload = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "Send a valid JSON body." }, { status: 400, headers }); }

  const pr = payload.pull_request;
  if (payload.action !== "closed" || pr?.merged !== true || !pr.html_url) {
    return NextResponse.json({ ignored: true }, { status: 202, headers });
  }
  const resolved = await resolveIssuesForMergedPullRequest(pr.html_url);
  return NextResponse.json({ resolved }, { headers });
}

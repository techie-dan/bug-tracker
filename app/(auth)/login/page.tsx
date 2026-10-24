import Link from "next/link";
import { BrandLockup } from "@/components/brand-lockup";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { LoginForm } from "@/components/login-form";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { isGoogleOAuthConfigured } from "@/lib/google-oauth";
import { safeCallbackUrl } from "@/lib/safe-callback-url";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Sign in" };

/**
 * Authenticated users are redirected to /bugs by middleware (`auth` wrapper).
 * Errors show fixed copy per `?error=` code only; any other query text (such
 * as the old `?reason=`) is never rendered (#118). Details are in server logs.
 * Google OAuth is the primary sign-in mechanism for Zedu Bugs.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
    expired?: string;
    error?: string;
    reason?: string;
  }>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const googleConfigured = isGoogleOAuthConfigured();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 hover:underline"
          >
            ← Back to Homepage
          </Link>
        </div>
        <BrandLockup href="/" size="md" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">
          Sign in to Ziki
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Sign in with your Google account to report, vote, and track issues.
        </p>

        {params.expired && !params.error ? (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
            Your session ended. Sign in again to continue.
          </p>
        ) : null}

        {params.error ? (
          <div
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            <p className="font-medium">
              {params.error === "TwoFactor"
                ? "This account has two-factor sign-in on. Sign in with email and password, then enter the code. Google cannot skip that step."
                : params.error === "OAuthCallbackError" || params.error === "Configuration"
                  ? "Unable to complete Google sign-in. Please try again."
                  : "Authentication failed. Please try again."}
            </p>
            {params.reason ? (
              <p className="mt-1.5 font-mono text-xs text-red-800 break-words">
                Diagnostic: {params.reason}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6">
          {/* #203: LoginForm existed with zero importers, so whenever password
              auth is enabled (local dev, the demo seed, or any deployment with
              AUTH_PASSWORD_LOGIN=true) this page offered no way to sign in and
              /forgot-password + /reset-password were unreachable by link. */}
          {isPasswordAuthEnabled() ? (
            <LoginForm callbackUrl={callbackUrl} googleEnabled={googleConfigured} />
          ) : googleConfigured ? (
            <GoogleSignInButton callbackUrl={callbackUrl} />
          ) : (
            <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900" role="alert">
              <p className="font-medium">Google sign-in is not configured.</p>
              <p className="mt-1">
                Set <code className="font-mono px-1 rounded bg-amber-100">GOOGLE_CLIENT_ID</code> and
                <code className="font-mono px-1 rounded bg-amber-100">GOOGLE_CLIENT_SECRET</code>
                in your environment to enable Google sign-in.
              </p>
              <p className="mt-2">
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-700 hover:underline"
                >
                  Configure in Google Cloud Console
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Guidance for autonomous agents & API documentation */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-teal-100 text-teal-700 text-xs">
              🤖
            </span>
            <span>Looking for Agent API Docs or LLM Specs?</span>
          </div>
          <p className="mt-1 text-slate-600 leading-normal">
            Autonomous agents interact via API keys and the live event feed. Inspect the machine-readable spec or explore the platform overview.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 font-medium">
            <Link
              href="/llms.txt"
              className="text-teal-700 hover:text-teal-800 hover:underline"
            >
              /llms.txt Specification &rarr;
            </Link>
            <span className="text-slate-300">·</span>
            <Link
              href="/"
              className="text-slate-700 hover:text-slate-900 hover:underline"
            >
              Public Homepage
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

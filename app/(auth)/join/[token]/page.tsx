import type { Metadata } from "next";
import Link from "next/link";
import { BrandLockup } from "@/components/brand-lockup";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/local-time";
import { auth } from "@/auth";
import { selectTenantAction } from "@/app/(app)/tenants/actions";
import { requireUser } from "@/lib/auth-helpers";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { isInviteToken } from "@/lib/invites";
import { prisma } from "@/lib/prisma";
import { SHARE_LINK_ERRORS, previewShareLink, shareJoinPath, shareLinkAudience } from "@/lib/share-invites";
import { AutoJoin } from "./auto-join";

export const metadata: Metadata = {
  title: "Join",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const card = "rounded-2xl border border-slate-200 bg-white p-6 sm:p-8";

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code in SHARE_LINK_ERRORS) return SHARE_LINK_ERRORS[code as keyof typeof SHARE_LINK_ERRORS];
  return null;
}

/**
 * Where a shareable invite link lands. Guests see the organization and sign
 * in with Google; signing in creates an account when they don't have one,
 * then attaches the organization. The link is not used until that POST.
 */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { token } = await params;
  const { error: errorParam } = await searchParams;
  const errorCode = typeof errorParam === "string" ? errorParam : undefined;
  const error = errorMessage(errorCode);

  if (!isInviteToken(token)) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-16">
        <div className={card}>
          <BrandLockup href="/" size="md" />
          <p role="status" className="mt-6 text-sm text-amber-900">
            {SHARE_LINK_ERRORS.invalid}
          </p>
        </div>
      </main>
    );
  }

  const session = await auth();
  const user = session?.user ? await requireUser() : null;
  const preview = await previewShareLink(prisma, token, user ? { id: user.id } : undefined);
  const callbackUrl = shareJoinPath(token);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-16">
      <div className={card}>
        <BrandLockup href="/" size="md" />

        {!preview ? (
          <p role="status" className="mt-6 text-sm text-amber-900">
            {SHARE_LINK_ERRORS.invalid}
          </p>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-slate-900">Join {preview.tenant.name}</h1>
              <p className="text-sm text-slate-600">
                {preview.invitedByName} invited you to {preview.tenant.name} on Ziki. You&apos;ll join as a member.
              </p>
            </div>

            {error ? (
              <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {error}
              </p>
            ) : null}

            {preview.alreadyMember && user ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  You&apos;re already a member of <strong className="text-slate-900">{preview.tenant.name}</strong>.
                </p>
                <form action={selectTenantAction}>
                  <input type="hidden" name="tenantId" value={preview.tenant.id} />
                  <Button type="submit" className="w-full">
                    Open {preview.tenant.name}
                  </Button>
                </form>
              </div>
            ) : preview.state !== "open" ? (
              <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {SHARE_LINK_ERRORS[preview.state === "expired" ? "expired" : preview.state === "revoked" ? "revoked" : "used"]}
              </p>
            ) : user ? (
              <AutoJoin token={token} tenantName={preview.tenant.name} auto={!error} />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-700">{shareLinkAudience(preview)}</p>
                <p className="text-sm text-slate-700">
                  The link expires <LocalTime date={preview.expiresAt} />. Sign in with Google — if you don&apos;t have
                  an account yet, one is created — and {preview.tenant.name} is added to it.
                </p>
                <GoogleSignInButton callbackUrl={callbackUrl} />
                {isPasswordAuthEnabled() ? (
                  <p className="text-center text-sm text-slate-600">
                    <Link
                      href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                      className="text-teal-700 hover:underline"
                    >
                      Sign in with email instead
                    </Link>
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

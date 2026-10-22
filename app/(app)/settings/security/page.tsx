import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { twoFactorStatus } from "@/lib/two-factor";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { TwoFactorSettings } from "./two-factor-settings";

export const metadata = { title: "Security" };

export default async function SecuritySettingsPage() {
  const user = await requireUser();
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  const hasPassword = Boolean(account?.passwordHash);
  const status = hasPassword ? await twoFactorStatus(user.id) : { enabled: false, backupCodesLeft: 0 };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <Link href="/settings" className="text-sm text-teal-700 hover:underline">
          ← Back to settings
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">Security</h1>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Two-factor sign-in
        </h2>
        {hasPassword ? (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Ask for a 6-digit code from an authenticator app (such as Google Authenticator, 1Password
              or Authy) as well as your password, so a stolen or reused password is not enough to get in.
            </p>
            {!isPasswordAuthEnabled() ? (
              <p className="mt-2 text-sm text-amber-700">
                Password sign-in is turned off on this site, so the code is not asked for here.
              </p>
            ) : null}
            <TwoFactorSettings enabled={status.enabled} backupCodesLeft={status.backupCodesLeft} />
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Your account signs in with Google, so turn on Google&apos;s 2-Step Verification in your Google
            account instead. There is no password here to protect.
          </p>
        )}
      </section>
    </div>
  );
}

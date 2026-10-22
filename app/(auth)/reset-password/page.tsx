import Link from "next/link";
import { notFound } from "next/navigation";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { BrandLockup } from "@/components/brand-lockup";
import { ResetPasswordForm } from "@/components/reset-password-form";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Set a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (!isPasswordAuthEnabled()) notFound();

  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token.trim() : "";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <BrandLockup href="/" size="md" />
        <h1 className="mt-3 text-lg font-medium text-slate-900">
          Set a new password
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Choose a new password of at least 8 characters. Your old password
          will stop working immediately.
        </p>
        <div className="mt-6">
          {token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <p className="text-sm text-red-600" role="alert">
              This reset link is invalid or incomplete. Request a new one from
              the forgot password page.
            </p>
          )}
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">
          <Link
            href="/forgot-password"
            className="font-medium text-teal-700 hover:underline"
          >
            Request a new reset link
          </Link>
          {" · "}
          <Link
            href="/login"
            className="font-medium text-teal-700 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

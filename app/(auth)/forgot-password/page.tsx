import Link from "next/link";
import { notFound } from "next/navigation";
import { isPasswordAuthEnabled } from "@/lib/auth-mode";
import { BrandLockup } from "@/components/brand-lockup";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  if (!isPasswordAuthEnabled()) notFound();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <BrandLockup href="/" size="md" />
        <h1 className="mt-3 text-lg font-medium text-slate-900">
          Forgot password
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter your email and we&apos;ll send a reset link if an account
          exists.
        </p>
        <div className="mt-6">
          <ForgotPasswordForm />
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">
          Remembered it?{" "}
          <Link
            href="/login"
            className="font-medium text-teal-700 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

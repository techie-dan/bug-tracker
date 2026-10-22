"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { googleSignInAction, loginAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

export function LoginForm({
  callbackUrl = "/issues",
  googleEnabled = false,
}: {
  callbackUrl?: string;
  googleEnabled?: boolean;
}) {
  // Only show Google button if OAuth is actually configured
  const showGoogleButton = googleEnabled;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Set once the password was right and the account has two-factor on (#648).
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // True when the error is about the credentials, so both fields are marked
  // invalid and described by the one message (#309). It never says which of
  // the two was wrong: that would reveal whether the account exists.
  const [credentialsInvalid, setCredentialsInvalid] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (credentialsInvalid) document.getElementById("email")?.focus();
  }, [credentialsInvalid]);
  useEffect(() => {
    if (needsCode) document.getElementById("totp")?.focus();
  }, [needsCode]);

  const fieldAttrs = credentialsInvalid
    ? ({ "aria-invalid": true, "aria-describedby": "login-error" } as const)
    : {};

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setCredentialsInvalid(false);
        const formData = new FormData();
        formData.set("email", email);
        formData.set("password", password);
        if (needsCode) formData.set("totp", code);
        formData.set("callbackUrl", callbackUrl);
        startTransition(async () => {
          try {
            const result = await loginAction(undefined, formData);
            if (result?.error) {
              setError(result.error);
              setCredentialsInvalid(Boolean(result.field));
              if (result.needsCode) {
                setNeedsCode(true);
                setCode("");
              } else {
                setNeedsCode(false);
              }
            }
            // Success uses server redirect() only — no client router.push
            // (avoids navigation storms with middleware redirects).
          } catch (error) {
            // Must rethrow NEXT_REDIRECT so the framework can navigate
            unstable_rethrow(error);
            setError("Something went wrong. Please try again.");
          }
        });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-slate-700">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          {...fieldAttrs}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="password"
            className="text-sm font-medium text-slate-700"
          >
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-teal-700 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          {...fieldAttrs}
        />
      </div>
      {needsCode ? (
        <div className="space-y-1.5">
          <label htmlFor="totp" className="text-sm font-medium text-slate-700">
            Authentication code
          </label>
          <Input
            id="totp"
            name="totp"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-describedby="totp-help"
          />
          <p id="totp-help" className="text-xs text-slate-500">
            Open your authenticator app and enter the 6-digit code. Lost your phone? Use one of
            your backup codes instead.
          </p>
        </div>
      ) : null}
      {error ? (
        <p id="login-error" className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : needsCode ? "Verify and sign in" : "Sign in"}
      </Button>
      {showGoogleButton ? (
        <>
          <div className="relative py-1 text-center text-xs text-slate-500">
            <span className="bg-white px-2 relative z-10">or</span>
            <span className="absolute inset-x-0 top-1/2 border-t border-slate-200" />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                try {
                  await googleSignInAction();
                } catch (error) {
                  unstable_rethrow(error);
                  setError("Google sign-in failed. Please try again.");
                }
              });
            }}
          >
            Continue with Google
          </Button>
        </>
      ) : null}
    </form>
  );
}

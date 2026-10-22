"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePasswordAction, type ChangePasswordResult } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { FieldError, useFieldErrors } from "@/components/ui/field-errors";
import { PasswordInput } from "@/components/ui/password-input";

const FORM_ID = "change-password";

/** Lets a credentials user rotate their password without relying on SMTP (#570). */
export function ChangePasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const { fieldErrors, show, clear, attrs } = useFieldErrors(FORM_ID, formRef);
  const [result, action, pending] = useActionState<ChangePasswordResult | undefined, FormData>(
    changePasswordAction,
    undefined,
  );

  useEffect(() => {
    if (!result) return;
    if (!result.ok) show(result);
    else clear();
  }, [result, show, clear]);

  return (
    <form ref={formRef} action={action} className="mt-4 space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="currentPassword" className="text-sm font-medium text-slate-800">Current password</label>
        <PasswordInput id="currentPassword" name="currentPassword" autoComplete="current-password" required {...attrs("currentPassword")} />
        <FieldError formId={FORM_ID} field="currentPassword" errors={fieldErrors} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="newPassword" className="text-sm font-medium text-slate-800">New password</label>
        <PasswordInput id="newPassword" name="password" autoComplete="new-password" minLength={8} required {...attrs("password")} />
        <FieldError formId={FORM_ID} field="password" errors={fieldErrors} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-slate-800">Confirm new password</label>
        <PasswordInput id="confirmPassword" name="confirmPassword" visibilityLabel="confirm new password" autoComplete="new-password" minLength={8} required {...attrs("confirmPassword")} />
        <FieldError formId={FORM_ID} field="confirmPassword" errors={fieldErrors} />
      </div>
      {result?.error && !result.field ? <p className="text-sm text-red-600" role="alert">{result.error}</p> : null}
      {result?.ok ? <p className="text-sm text-emerald-700" role="status">Password updated. Sign in again to continue.</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Updating…" : "Change password"}</Button>
    </form>
  );
}

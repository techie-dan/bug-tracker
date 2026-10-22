import Link from "next/link";
import { auth } from "@/auth";
import {
  StatusPage,
  primaryActionClass,
  secondaryActionClass,
} from "@/components/status-page";

/**
 * Shown when an issue page calls notFound(), e.g. an issue id that doesn't
 * exist or was deleted (#214). It sits above [id] so the 404 thrown by
 * [id]/layout.tsx lands here too. Anonymous visitors (link-preview
 * fallbacks) get a sign-in link, because the issue may simply need a
 * session to view.
 */
export default async function IssueNotFound() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <StatusPage
      code="404"
      title="We couldn't find that issue"
      actions={
        <>
          <Link href="/issues" className={primaryActionClass}>
            Go to issues
          </Link>
          {signedIn ? null : (
            <Link href="/login" className={secondaryActionClass}>
              Sign in
            </Link>
          )}
        </>
      }
    >
      <p>
        The link may be wrong, or the issue may have been deleted.
        {signedIn ? null : " Some issues are only visible after you sign in."}
      </p>
    </StatusPage>
  );
}

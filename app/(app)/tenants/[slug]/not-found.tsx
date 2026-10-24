import Link from "next/link";
import { StatusPage, primaryActionClass } from "@/components/status-page";

/**
 * The same page whether the tenant doesn't exist or the person isn't in it
 * (#444), so guessing slugs tells nobody which tenants exist.
 */
export default function TenantNotFound() {
  return (
    <StatusPage
      code="404"
      title="We couldn't find that workspace"
      actions={
        <Link href="/tenants" className={primaryActionClass}>
          Your workspaces
        </Link>
      }
    >
      <p>The link may be wrong, or you may not be a member. Workspaces are invite-only.</p>
    </StatusPage>
  );
}

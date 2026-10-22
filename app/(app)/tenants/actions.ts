"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth-helpers";
import { fieldError } from "@/lib/form-errors";
import {
  ACCEPT_INVITE_RATE_LIMIT,
  CREATE_INVITE_RATE_LIMIT,
  acceptInvite,
  createInvite,
  deliverInvite,
  destinationForInviteInput,
  inviteUrl,
  revokeInvite,
  type InviteDelivery,
} from "@/lib/invites";
import { acceptShareLink, createShareLink, revokeShareLink } from "@/lib/share-invites";
import { prisma } from "@/lib/prisma";
import { notifyLater } from "@/lib/notify";
import { isTenantAdminRole } from "@/lib/agents/membership";
import {
  TENANT_DESCRIPTION_MAX,
  TENANT_JOIN_REQUEST_RATE_LIMIT,
  requestTenantMembership,
  reviewTenantMembershipRequest,
} from "@/lib/tenant-join-requests";
import { setActiveProjectCookie } from "@/lib/project-context";
import { RATE_LIMIT_MESSAGE, consumeRateLimit } from "@/lib/rate-limit";
import {
  CREATE_TENANT_RATE_LIMIT,
  createTenant,
  createTenantSchema,
  deleteTenant,
  memberTenantById,
  promoteFirstZeduOwner,
  renameTenant,
  setActiveTenantCookie,
  setTenantArchived,
  type PromoteOwnerResult,
} from "@/lib/tenants";

/**
 * The tenant picker's actions (#444). Each acts as the signed-in person and
 * only ever on tenants they belong to; lib/tenants.ts and lib/invites.ts
 * hold the rules.
 */

export type TenantFormResult = {
  error?: string;
  field?: string;
  fieldErrors?: Record<string, string>;
  /** #537: the name to confirm before a second tenant with it is created. */
  duplicateName?: string;
};

const discoverySettingsSchema = z.object({
  description: z.string().trim().max(TENANT_DESCRIPTION_MAX, `Description must be ${TENANT_DESCRIPTION_MAX} characters or fewer.`),
});

/** Work in this tenant on this device, and go to its issues. */
async function enterTenant(tenantId: string, projectId?: string): Promise<never> {
  await setActiveTenantCookie(tenantId);
  if (projectId) await setActiveProjectCookie(projectId);
  revalidatePath("/", "layout");
  redirect("/issues");
}

/**
 * Open one of the person's tenants. An id they aren't a member of changes
 * nothing and says nothing about whether that tenant exists.
 */
export async function selectTenantAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tenant = await memberTenantById(prisma, user.id, String(formData.get("tenantId") ?? ""));
  if (!tenant) redirect("/tenants");
  if (tenant.archivedAt) {
    redirect(`/tenants?error=${encodeURIComponent("Restore this organization before opening it.")}`);
  }
  await enterTenant(tenant.id);
}

/** An owner or admin controls whether this tenant appears in discovery. */
export async function updateTenantDiscoveryAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tenantId = String(formData.get("tenantId") ?? "");
  const parsed = discoverySettingsSchema.safeParse({ description: String(formData.get("description") ?? "") });
  if (!tenantId || !parsed.success) return;
  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId: user.id } },
    select: { role: true, tenant: { select: { slug: true } } },
  });
  if (!membership || !isTenantAdminRole(membership.role, user.role)) return;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      discoverable: formData.get("discoverable") === "on",
      description: parsed.data.description || null,
    },
  });
  revalidatePath(`/tenants/${membership.tenant.slug}`);
  revalidatePath("/tenants");
}

export type JoinTenantActionResult = { pending?: boolean; error?: string };

/** Request a place without creating a membership; only an admin can approve it. */
export async function requestTenantJoinAction(
  _previous: JoinTenantActionResult | undefined,
  formData: FormData,
): Promise<JoinTenantActionResult> {
  const user = await requireUser();
  if (!(await consumeRateLimit(`tenant-join-request:${user.id}`, TENANT_JOIN_REQUEST_RATE_LIMIT)).allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }
  const result = await requestTenantMembership(prisma, user.id, String(formData.get("tenantId") ?? ""));
  if (!result.ok) return { error: result.error };

  if (result.created) {
    const managers = await prisma.membership.findMany({
      where: { tenantId: result.tenantId, role: { in: ["owner", "admin"] } },
      select: { userId: true },
    });
    for (const manager of managers) {
      notifyLater({
        kind: "tenant_join_request",
        actorId: null,
        actorName: user.name || user.email || "Someone",
        recipientId: manager.userId,
        requestId: result.requestId,
        tenantId: result.tenantId,
        tenantName: result.tenantName,
        tenantSlug: result.slug,
      });
    }
  }
  revalidatePath("/tenants");
  return { pending: true };
}

/** Review a pending request. Approval adds a member inside the same transaction. */
export async function reviewTenantJoinRequestAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const requestId = String(formData.get("requestId") ?? "");
  const status = formData.get("status");
  if (!requestId || (status !== "approved" && status !== "rejected")) return;
  const request = await prisma.tenantJoinRequest.findUnique({
    where: { id: requestId },
    select: { tenantId: true },
  });
  if (!request) return;
  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId: request.tenantId, userId: user.id } },
    select: { role: true },
  });
  if (!isTenantAdminRole(membership?.role, user.role)) return;

  const result = await reviewTenantMembershipRequest(prisma, { requestId, reviewerId: user.id, status });
  if (!result.ok) return;
  notifyLater({
    kind: "tenant_join_request_result",
    actorId: user.id,
    actorName: user.name || user.email || "Someone",
    recipientId: result.userId,
    tenantId: result.tenantId,
    tenantName: result.tenantName,
    tenantSlug: result.slug,
    status: result.status as "approved" | "rejected",
  });
  revalidatePath(`/tenants/${result.slug}`);
  revalidatePath("/tenants");
}

/**
 * Switch to the tenant that owns an issue the viewer followed a link to
 * (#519), then land on that issue. Membership is re-checked here: the hint
 * on the page is presentation, this is the guard.
 */
export async function switchTenantForIssueAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const issueId = String(formData.get("issueId") ?? "");
  const tenant = await memberTenantById(prisma, user.id, String(formData.get("tenantId") ?? ""));
  if (!tenant || tenant.archivedAt) redirect("/issues");
  await setActiveTenantCookie(tenant.id);
  await setActiveProjectCookie("");
  revalidatePath("/", "layout");
  redirect(`/issues/${encodeURIComponent(issueId)}`);
}

/** Create a tenant owned by the person, with its first project, and enter it. */
export async function createTenantAction(
  _previous: TenantFormResult | undefined,
  formData: FormData,
): Promise<TenantFormResult> {
  const user = await requireUser();
  const input = { name: formData.get("name") ?? "", projectName: formData.get("projectName") ?? "" };

  // Typos don't count against the limit; only real attempts do.
  const parsed = createTenantSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fieldError(issue?.path[0] === "projectName" ? "projectName" : "name", issue?.message ?? "Check the name.");
  }
  if (!(await consumeRateLimit(`tenant-create:${user.id}`, CREATE_TENANT_RATE_LIMIT)).allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const confirmDuplicate = formData.get("confirmDuplicate");
  const result = await createTenant(prisma, user, {
    ...input,
    ...(typeof confirmDuplicate === "string" && confirmDuplicate ? { confirmDuplicate } : {}),
  });
  if (!result.ok) {
    const error = fieldError(result.field ?? "name", result.error);
    return result.duplicateName ? { ...error, duplicateName: result.duplicateName } : error;
  }
  return enterTenant(result.tenant.id, result.projectId);
}

/** Rename a tenant the person owns; the slug stays the same. */
export async function renameTenantAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tenantId = String(formData.get("tenantId") ?? "");
  const tenant = await memberTenantById(prisma, user.id, tenantId);
  if (!tenant) redirect("/tenants");

  const result = await renameTenant(prisma, user.id, tenantId, formData.get("name"));
  if (!result.ok) {
    redirect(`/tenants/${tenant.slug}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/", "layout");
  revalidatePath("/tenants");
  revalidatePath(`/tenants/${tenant.slug}`);
  redirect(`/tenants/${tenant.slug}?notice=${encodeURIComponent("Organization renamed.")}`);
}

/** Archive or restore a tenant the person owns. */
export async function setTenantArchivedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tenantId = String(formData.get("tenantId") ?? "");
  const tenant = await memberTenantById(prisma, user.id, tenantId);
  if (!tenant) redirect("/tenants");

  const archived = String(formData.get("archived") ?? "") === "true";
  const result = await setTenantArchived(prisma, user.id, tenantId, archived);
  if (!result.ok) {
    redirect(`/tenants/${tenant.slug}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/", "layout");
  revalidatePath("/tenants");
  revalidatePath(`/tenants/${tenant.slug}`);
  redirect(`/tenants?notice=${encodeURIComponent(archived ? "Organization archived." : "Organization restored.")}`);
}

/** Delete an empty tenant after the owner types its name. */
export async function deleteTenantAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const tenantId = String(formData.get("tenantId") ?? "");
  const tenant = await memberTenantById(prisma, user.id, tenantId);
  if (!tenant) redirect("/tenants");

  const result = await deleteTenant(prisma, user.id, tenantId, formData.get("confirmName"));
  if (!result.ok) {
    redirect(`/tenants/${tenant.slug}?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/", "layout");
  revalidatePath("/tenants");
  redirect(`/tenants?notice=${encodeURIComponent("Organization deleted.")}`);
}

export type CreateInviteActionResult =
  | {
      ok: true;
      email: string;
      /** The single-use link, shown to the inviter this once. */
      link: string;
      expiresAt: string;
      delivery: InviteDelivery;
    }
  | { ok: false; error: string; field?: string };

/** An owner or admin invites an email address into their tenant. */
export async function createInviteAction(
  _previous: CreateInviteActionResult | undefined,
  formData: FormData,
): Promise<CreateInviteActionResult> {
  const user = await requireUser();
  if (!(await consumeRateLimit(`tenant-invite:${user.id}`, CREATE_INVITE_RATE_LIMIT)).allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }

  const result = await createInvite(prisma, user, {
    tenantId: String(formData.get("tenantId") ?? ""),
    email: formData.get("email"),
  });
  if (!result.ok) return result;

  let delivery: InviteDelivery = "manual";
  try {
    delivery = await deliverInvite(prisma, {
      invite: result.invite,
      rawToken: result.rawToken,
      tenantId: result.tenant.id,
      tenantName: result.tenant.name,
      inviter: { id: user.id, name: user.name || user.email || "Someone" },
    });
  } catch (error) {
    // The invite exists and the inviter still gets the link to send.
    console.error("[invites] could not tell the invitee", {
      inviteId: result.invite.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  revalidatePath(`/tenants/${result.tenant.slug}`);
  return {
    ok: true,
    email: result.invite.email,
    link: inviteUrl(result.rawToken),
    expiresAt: result.invite.expiresAt.toISOString(),
    delivery,
  };
}

export type CreateShareLinkActionResult =
  | { ok: true; url: string }
  | { ok: false; error: string; field?: string };

/** An owner or admin creates a link anyone can use, within the limits they set. */
export async function createShareLinkAction(
  _previous: CreateShareLinkActionResult | undefined,
  formData: FormData,
): Promise<CreateShareLinkActionResult> {
  const user = await requireUser();
  if (!(await consumeRateLimit(`tenant-share:${user.id}`, CREATE_INVITE_RATE_LIMIT)).allowed) {
    return { ok: false, error: RATE_LIMIT_MESSAGE };
  }

  const result = await createShareLink(prisma, user, {
    tenantId: String(formData.get("tenantId") ?? ""),
    expiresDays: formData.get("expiresDays"),
    maxUses: formData.get("maxUses"),
    label: formData.get("label"),
  });
  if (!result.ok) return result;

  revalidatePath(`/tenants/${result.tenantSlug}`);
  return { ok: true, url: result.url };
}

/** Turn off a share link that hasn't been revoked yet. */
export async function revokeShareLinkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const result = await revokeShareLink(prisma, user, String(formData.get("linkId") ?? ""));
  if (result.ok) revalidatePath(`/tenants/${result.tenantSlug}`);
}

/**
 * Join via a share link. Called from the join page after Google sign-in, or
 * from the Join button if the person is already signed in.
 */
export async function acceptShareLinkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = String(formData.get("token") ?? "");
  const back = `/join/${token}`;
  if (!(await consumeRateLimit(`tenant-share-accept:${user.id}`, ACCEPT_INVITE_RATE_LIMIT)).allowed) {
    redirect(`${back}?error=rate`);
  }

  const result = await acceptShareLink(prisma, token, user);
  if (!result.ok) redirect(`${back}?error=${result.reason}`);
  return enterTenant(result.tenant.id);
}

/** Withdraw a link that hasn't been used. */
export async function revokeInviteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const result = await revokeInvite(prisma, user, String(formData.get("inviteId") ?? ""));
  if (result.ok) revalidatePath(`/tenants/${result.tenantSlug}`);
}

export type AcceptInviteActionResult = { error?: string };

/** Accept an invite, by its link or from an in-app notification. */
export async function acceptInviteAction(
  _previous: AcceptInviteActionResult | undefined,
  formData: FormData,
): Promise<AcceptInviteActionResult> {
  const user = await requireUser();
  if (!(await consumeRateLimit(`tenant-accept:${user.id}`, ACCEPT_INVITE_RATE_LIMIT)).allowed) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const token = formData.get("token");
  const inviteId = formData.get("inviteId");
  const result = await acceptInvite(
    prisma,
    typeof token === "string" && token
      ? { token }
      : { inviteId: typeof inviteId === "string" ? inviteId : "" },
    user,
  );
  if (!result.ok) return { error: result.error };
  return enterTenant(result.tenant.id);
}

/** Paste an invite link to open it. */
export async function openInviteLinkAction(
  _previous: TenantFormResult | undefined,
  formData: FormData,
): Promise<TenantFormResult> {
  await requireUser();
  const destination = destinationForInviteInput(String(formData.get("link") ?? ""));
  if (!destination) {
    return fieldError("link", "That isn't a Ziki invite link. Paste the whole link from the invite.");
  }
  redirect(destination);
}

/** The site's super admin makes an existing Zedu member its first owner. */
export async function promoteZeduOwnerAction(
  _previous: PromoteOwnerResult | undefined,
  formData: FormData,
): Promise<PromoteOwnerResult> {
  const user = await requireUser();
  const result = await promoteFirstZeduOwner(prisma, user, formData.get("email"));
  if (result.ok) revalidatePath("/tenants");
  return result;
}

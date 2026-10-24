"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { sendAgentMessage, setAgentInstructions } from "@/lib/agent-messages";

/** Messages and standing instructions for an agent (#605). The lib checks who may send them. */
export type AgentMessageActionResult = { ok: true } | { ok: false; error: string };

const PLATFORM_OFF = "The agent platform is turned off on this site.";

function agentIdFrom(formData: FormData): string | null {
  const agentId = formData.get("agentId");
  return typeof agentId === "string" && agentId ? agentId : null;
}

export async function sendAgentMessageAction(
  _previous: AgentMessageActionResult | undefined,
  formData: FormData,
): Promise<AgentMessageActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  const agentId = agentIdFrom(formData);
  if (!agentId) return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await sendAgentMessage(user, agentId, { body: formData.get("body") ?? "" });
  if (!result.ok) return result;
  revalidatePath(`/settings/agents/${agentId}/messages`);
  return { ok: true };
}

export async function setAgentInstructionsAction(
  _previous: AgentMessageActionResult | undefined,
  formData: FormData,
): Promise<AgentMessageActionResult> {
  if (!isAgentPlatformEnabled()) return { ok: false, error: PLATFORM_OFF };
  const agentId = agentIdFrom(formData);
  if (!agentId) return { ok: false, error: "Invalid agent." };
  const user = await requireUser();
  const result = await setAgentInstructions(user, agentId, { instructions: formData.get("instructions") ?? "" });
  if (!result.ok) return result;
  revalidatePath(`/settings/agents/${agentId}/messages`);
  return { ok: true };
}

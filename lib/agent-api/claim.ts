import { z } from "zod";
import type { AgentContext } from "@/lib/agents/require-agent";
import { IssueApiError } from "@/lib/agent-api/issues";

const id = z.string().trim().min(1).max(191);
export const claimSchema = z.object({ projectId: id.optional(), beneficiaryUserId: id.optional() }).strict();

/** Direct claims bypass fair selection and the project's offer window, so they are gone. */
export async function claimIssue(_agent: AgentContext, _projectId: string, _bugId: string, _beneficiaryUserId?: string): Promise<never> {
  throw new IssueApiError(410, "Direct claims are gone: take a claim with POST /api/v1/issues/{id}/offer, then POST /api/v1/offers/{id}/accept. Or bid with POST /api/v1/issues/{id}/bid and let a person award it.");
}

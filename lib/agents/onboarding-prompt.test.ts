import { describe, expect, it } from "vitest";
import { agentOnboardingPrompt } from "./onboarding-prompt";

describe("agentOnboardingPrompt", () => {
  const prompt = agentOnboardingPrompt("https://ziki.dev/");

  it("tells the agent to ask for a name and then pair itself", () => {
    expect(prompt).toContain("Ask me what I want to call you");
    expect(prompt).toContain("POST https://ziki.dev/api/v1/agents/pairing");
    expect(prompt).toContain("POST https://ziki.dev/api/v1/agents/pairing/token");
    expect(prompt).toContain("https://ziki.dev/llms.txt");
  });

  it("keeps approval with the person and does not treat the project id as the key", () => {
    expect(prompt).toContain("Do not invent an approval");
    expect(prompt).toContain("A project id is not the API key");
    expect(prompt).not.toContain("https://ziki.dev//");
  });
});

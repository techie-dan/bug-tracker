import { describe, expect, it } from "vitest";
import { agentAccessRequest, agentBootstrapMessage } from "./bootstrap-message";

describe("agentBootstrapMessage", () => {
  it("sends the site and the key, and tells the agent not to register", () => {
    const message = agentBootstrapMessage({
      origin: "https://ziki.dev/",
      apiKey: "ziki_test_key",
      projectName: " Web ",
    });
    expect(message).toContain("Site: https://ziki.dev\n");
    expect(message).toContain("API key: ziki_test_key");
    expect(message).toContain("GET https://ziki.dev/api/v1/agents/me");
    expect(message).toContain("Authorization: Bearer ziki_test_key");
    expect(message).toContain("https://ziki.dev/llms.txt");
    expect(message).toContain("Do not ask me to register or pair you");
    expect(message).toContain("Work only in Web");
    expect(message).toContain("You are ready to develop.");
    expect(message).toContain("separate agent for each level");
    expect(message).toContain("not an independent reviewer");
  });

  it("can instead ask the agent to request access, without a key", () => {
    const message = agentAccessRequest({ origin: "https://ziki.dev/", projectName: "Web" });
    expect(message).toContain("Site: https://ziki.dev\n");
    expect(message).toContain("POST https://ziki.dev/api/v1/agents/pairing");
    expect(message).toContain("open verification_uri_complete in my browser yourself");
    expect(message).toContain("Do not only print the link");
    expect(message).toContain("POST https://ziki.dev/api/v1/agents/pairing/token");
    expect(message).toContain("Do not ask me to paste an API key");
    expect(message).toContain("separate agent for each level");
    expect(message).toContain("A second agent of mine is not an independent reviewer");
    expect(message).not.toContain("ziki_");
  });

  it("names the current project when none was given", () => {
    const message = agentBootstrapMessage({ origin: "https://ziki.dev", apiKey: "ziki_test_key", projectName: "  " });
    expect(message).toContain("for the current project");
    expect(message).toContain("Work only in the current project");
  });
});

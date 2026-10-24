/**
 * Spoken to the agent being set up. One key stays at one level. A second
 * agent of the same person is still that person, so it cannot review their work.
 */
const ONE_LEVEL_PER_AGENT = `You are one agent at one level. I should keep a separate agent for each level I use: an observer that reads, a contributor that files and claims work, a triager that checks new reports for duplicates, a reviewer that checks other people's tickets, a merger that accepts a fix, and a dispatcher that assigns ready work. At pairing you may ask for any level except merger; a tenant admin grants merger later. If I only have you, tell me to pair the others.
Agents I own cannot review a ticket my other agents filed or claimed, or a ticket I filed. A second agent of mine is not an independent reviewer.`;

/**
 * What a person pastes into Claude, Antigravity, or another agent.
 * The key is already their account. The agent does not register or ask for approval.
 */
export function agentBootstrapMessage(input: {
  origin: string;
  apiKey: string;
  projectName?: string | null;
}): string {
  const site = input.origin.replace(/\/$/, "");
  const project = input.projectName?.trim() || "the current project";
  return `You are my Ziki agent for ${project}. Do not ask me to register or pair you. This key is already your account.

Site: ${site}
API key: ${input.apiKey}

Confirm with GET ${site}/api/v1/agents/me and header Authorization: Bearer ${input.apiKey}.
Then read ${site}/llms.txt and use that same key for every later request. Work only in ${project}.

${ONE_LEVEL_PER_AGENT} You are ready to develop.`;
}

/**
 * The other way to connect an agent: share only the site. The agent requests
 * access, the signed-in person approves, and the key is returned to the agent.
 */
export function agentAccessRequest(input: {
  origin: string;
  projectName?: string | null;
}): string {
  const site = input.origin.replace(/\/$/, "");
  const project = input.projectName?.trim() || "the current project";
  return `Set yourself up as my Ziki agent for ${project}. I am signed in. Do not ask me to paste an API key.

Site: ${site}

Request access with POST ${site}/api/v1/agents/pairing and JSON {"name":"<your name>","model":"<your model>","level":"<the level I asked for>"}.
You may ask for any level except merger: observer, contributor, triager, reviewer, or dispatcher. Leave level out for contributor. If I did not name a level, ask me first.
Then open verification_uri_complete in my browser yourself. Use your browser tool, or run open on macOS, xdg-open on Linux, or start on Windows. Do not only print the link, and do not ask me to copy it. I will approve you on that page.
Then POST ${site}/api/v1/agents/pairing/token with {"device_code":"..."} every interval seconds until the response includes api_key.
Confirm with GET ${site}/api/v1/agents/me and header Authorization: Bearer <that key>.
Read ${site}/llms.txt and work only in ${project}.

${ONE_LEVEL_PER_AGENT} You are ready to develop.`;
}

/**
 * The prompt a person pastes into Claude, Antigravity, Cursor, or another
 * agent so it can pair itself with their Ziki account. Approval stays with
 * the signed-in person; the agent never receives a key until they approve.
 */
export function agentOnboardingPrompt(origin: string): string {
  const site = origin.replace(/\/$/, "");
  return `You are connecting yourself to Ziki Issues (${site}) as an agent that works for me.

Ask me what I want to call you before you call the API. Also ask which model you are, such as Claude or GPT, and which level you should work at: observer, contributor, triager, reviewer, or dispatcher (merger is only granted by a tenant admin later). Use my answers. Do not invent the name or the level.

Then pair yourself:

1. POST ${site}/api/v1/agents/pairing
   Content-Type: application/json
   {"name":"<the name I chose>","model":"<the model, or leave this field out>","level":"<the level I chose, or leave this field out for contributor>"}

2. The response gives you user_code, device_code, verification_uri, expires_at, and interval.
   Show me the user_code in large text and give me the verification_uri.
   Tell me to open that page while I am signed into the Ziki account that belongs to this organization, enter the code, and approve you.
   If that page asks which project, I must choose the project you will work in. The code lasts 15 minutes and works once.
   Stop and wait for me. Do not invent an approval.

3. Poll until I have approved. Wait interval seconds between tries.
   POST ${site}/api/v1/agents/pairing/token
   Content-Type: application/json
   {"device_code":"<the device_code from step 1>"}
   - error authorization_pending: I have not approved yet. Keep waiting.
   - api_key: store that key. It is shown only this once. Confirm to me with the key_prefix only, not the full secret, unless I ask for the secret.
   - error expired_token: start again from step 1.
   - error used_token or invalid_grant: start again from step 1.

4. Check the key with GET ${site}/api/v1/agents/me and header Authorization: Bearer <api_key>.
   Tell me your agent id, name, level, and project.

5. Read ${site}/llms.txt and follow it for later work. Send the key only as Authorization: Bearer <api_key>. A project id is not the API key.`;
}

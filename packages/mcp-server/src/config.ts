import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_URL = "https://ziki.dev";

export type ZikiConfig = {
  url: string;
  apiKey: string;
  /** The project the key is scoped to, when the pairing recorded one. */
  projectId: string | null;
};

type Env = Record<string, string | undefined>;

/** Same lookup as scripts/ziki-agent.mjs: ZIKI_AGENT_CONFIG, else $XDG_CONFIG_HOME/ziki/agent.json. */
export function configPath(env: Env = process.env): string {
  if (env.ZIKI_AGENT_CONFIG) return env.ZIKI_AGENT_CONFIG;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "ziki", "agent.json");
}

/**
 * Resolve the site URL, key and project. `ZIKI_URL` / `ZIKI_PROJECT_ID`
 * override the pairing file. `ZIKI_API_KEY` is honoured for hosts that inject
 * secrets, but the pairing file is the normal source so no key has to be
 * pasted into an assistant's config.
 */
export async function loadConfig(env: Env = process.env): Promise<ZikiConfig> {
  const file = configPath(env);
  let saved: { url?: string; apiKey?: string; projectId?: string | null } = {};
  try {
    saved = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw new Error(`Could not read ${file}: ${(error as Error).message}`);
    }
  }
  const apiKey = env.ZIKI_API_KEY || saved.apiKey;
  if (!apiKey) {
    throw new Error(
      `No Ziki key found. Run \`node scripts/ziki-agent.mjs pair\` first (it saves ${file}), or set ZIKI_API_KEY.`,
    );
  }
  const url = (env.ZIKI_URL || saved.url || DEFAULT_URL).replace(/\/+$/, "");
  return { url, apiKey, projectId: env.ZIKI_PROJECT_ID || saved.projectId || null };
}

import type { ZikiConfig } from "./config.js";

export class ZikiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ZikiApiError";
  }
}

export type RequestSpec = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Multipart upload. Sent as the `file` field instead of a JSON body. */
  file?: { filename: string; dataBase64: string };
  /** Keep a streaming response open for this many seconds, then return what arrived. */
  streamForSeconds?: number;
};

type FetchLike = typeof fetch;

/** Read a stream until `seconds` pass or the server closes it. */
async function readUntil(response: Response, seconds: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + seconds * 1000;
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), remaining)),
      ]);
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    // The listen window ended. Return the events that already arrived.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The server already closed the stream.
    }
  }
  return text;
}

/** A thin authenticated wrapper over `/api/v1`. Every call is one HTTP request. */
export class ZikiClient {
  constructor(
    readonly config: ZikiConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async request({ method, path, query, body, headers, file, streamForSeconds }: RequestSpec): Promise<unknown> {
    const url = new URL(`/api/v1${path}`, this.config.url);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    let payload: BodyInit | undefined;
    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: streamForSeconds ? "text/event-stream" : "application/json",
      ...headers,
    };
    if (file) {
      const bytes = Buffer.from(file.dataBase64, "base64");
      const form = new FormData();
      form.set("file", new Blob([bytes]), file.filename);
      payload = form;
    } else if (body) {
      requestHeaders["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const controller = streamForSeconds ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), streamForSeconds! * 1000) : null;
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: payload,
        signal: controller?.signal,
      });
      const text = streamForSeconds && response.ok ? await readUntil(response, streamForSeconds) : await response.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!response.ok) {
        const detail =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : response.statusText;
        throw new ZikiApiError(`${response.status} ${detail}`, response.status, data);
      }
      return data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

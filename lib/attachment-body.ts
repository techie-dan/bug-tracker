/**
 * Bounded multipart reading for the attachment routes (#485).
 *
 * The routes used to reject an oversized body only when the client declared a
 * large `Content-Length`. A chunked request declares nothing, so the guard
 * compared `0` (or `NaN` for a junk header) against the limit and passed, and
 * `request.formData()` then buffered the whole body before the 5 MB check ran.
 *
 * `readLimitedMultipart` reads the body itself and stops at the cap, so the
 * memory one request can pin is bounded whether or not the length is declared.
 */

/** Room for the multipart boundary and headers around one 5 MB file. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export type LimitedMultipartResult =
  | { ok: true; form: FormData }
  | { ok: false; status: 400 | 413; reason: "invalid-content-length" | "too-large" | "unreadable" };

type BodyRead =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: "too-large" | "unreadable" };

/** Read `body` into memory, giving up as soon as it passes `maxBytes`. */
async function readBodyUpTo(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<BodyRead> {
  if (!body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        return { ok: false, reason: "unreadable" };
      }
      if (next.done) break;
      const chunk = next.value;
      if (!chunk?.byteLength) continue;
      total += chunk.byteLength;
      if (total > maxBytes) {
        // Stop pulling: the rest of an oversized body is never buffered.
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too-large" };
      }
      chunks.push(chunk);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released by cancel().
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * Parse a multipart body, refusing anything over `maxBodyBytes`.
 *
 * A non-numeric `Content-Length` is a client error (400). A declared length
 * over the cap is refused without reading the body at all; a missing length
 * (chunked) is read through the same cap instead of being trusted.
 */
export async function readLimitedMultipart(
  request: Request,
  maxBodyBytes: number,
): Promise<LimitedMultipartResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const value = declared.trim();
    if (!/^\d+$/.test(value)) {
      return { ok: false, status: 400, reason: "invalid-content-length" };
    }
    if (Number(value) > maxBodyBytes) {
      return { ok: false, status: 413, reason: "too-large" };
    }
  }

  const read = await readBodyUpTo(request.body, maxBodyBytes);
  if (!read.ok) {
    return { ok: false, status: read.reason === "too-large" ? 413 : 400, reason: read.reason };
  }

  const contentType = request.headers.get("content-type") ?? "";
  try {
    const form = await new Response(read.bytes, { headers: { "content-type": contentType } }).formData();
    return { ok: true, form };
  } catch {
    return { ok: false, status: 400, reason: "unreadable" };
  }
}

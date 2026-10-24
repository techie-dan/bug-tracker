import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "./attachments";
import { MULTIPART_OVERHEAD_BYTES, readLimitedMultipart } from "./attachment-body";

const CAP = MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES;

/** A body that reports how much was actually pulled, so a test can prove we stopped early. */
function bodyStream(totalBytes: number, chunkSize = 512 * 1024) {
  let sent = 0;
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        if (sent >= totalBytes) {
          controller.close();
          return;
        }
        const size = Math.min(chunkSize, totalBytes - sent);
        sent += size;
        controller.enqueue(new Uint8Array(size));
      },
      cancel() {
        cancelled = true;
      },
    },
    // No prefetch: a pull then means someone actually read from the body.
    { highWaterMark: 0 },
  );
  return { stream, stats: () => ({ pulls, sent, cancelled }) };
}

function streamedRequest(stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    body: stream,
    headers: { "content-type": "multipart/form-data; boundary=test", ...headers },
    duplex: "half",
  };
  return new Request("http://localhost/api/uploads", init);
}

describe("readLimitedMultipart (#485)", () => {
  it("stops reading a chunked body once it passes the cap", async () => {
    const { stream, stats } = bodyStream(8 * 1024 * 1024);
    const result = await readLimitedMultipart(streamedRequest(stream), CAP);

    expect(result).toMatchObject({ ok: false, status: 413, reason: "too-large" });
    // 8 MB in 512 KB chunks is 16 pulls; the cap stops it around 5.06 MB.
    expect(stats().pulls).toBeLessThan(16);
    expect(stats().cancelled).toBe(true);
    expect(stats().sent).toBeLessThanOrEqual(11 * 512 * 1024);
  });

  it("rejects a non-numeric content-length without reading the body", async () => {
    const { stream, stats } = bodyStream(1024);
    const result = await readLimitedMultipart(streamedRequest(stream, { "content-length": "12abc" }), CAP);

    expect(result).toMatchObject({ ok: false, status: 400, reason: "invalid-content-length" });
    expect(stats().pulls).toBe(0);
  });

  it("rejects a negative content-length", async () => {
    const { stream } = bodyStream(1024);
    const result = await readLimitedMultipart(streamedRequest(stream, { "content-length": "-1" }), CAP);
    expect(result).toMatchObject({ ok: false, status: 400, reason: "invalid-content-length" });
  });

  it("refuses a declared length over the cap without touching the body", async () => {
    const { stream, stats } = bodyStream(8 * 1024 * 1024);
    const result = await readLimitedMultipart(streamedRequest(stream, { "content-length": String(CAP + 1) }), CAP);

    expect(result).toMatchObject({ ok: false, status: 413, reason: "too-large" });
    expect(stats().pulls).toBe(0);
  });

  it("still caps a body whose content-length under-reports its size", async () => {
    const { stream, stats } = bodyStream(8 * 1024 * 1024);
    const result = await readLimitedMultipart(streamedRequest(stream, { "content-length": "10" }), CAP);

    expect(result).toMatchObject({ ok: false, status: 413, reason: "too-large" });
    expect(stats().pulls).toBeLessThan(16);
  });

  it("parses a valid multipart body under the cap", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.append("file", new File([png], "shot.png", { type: "image/png" }));

    const request = new Request("http://localhost/api/uploads", { method: "POST", body: form });
    const result = await readLimitedMultipart(request, CAP);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const file = result.form.get("file");
    expect(file).toBeInstanceOf(File);
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(png);
    expect((file as File).name).toBe("shot.png");
  });

  it("reports a malformed multipart body as unreadable", async () => {
    const request = new Request("http://localhost/api/uploads", {
      method: "POST",
      body: "this is not multipart",
      headers: { "content-type": "multipart/form-data; boundary=test" },
    });
    const result = await readLimitedMultipart(request, CAP);
    expect(result).toMatchObject({ ok: false, status: 400, reason: "unreadable" });
  });
});

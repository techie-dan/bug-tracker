import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHARE_IMAGE } from "./share-image";

/**
 * The link-preview image is only ever seen through someone else's unfurler,
 * so nothing in the app fails when it is wrong — it just silently stops
 * appearing. These pin the constraints that made it break before (#117).
 */
describe("SHARE_IMAGE", () => {
  const file = join(process.cwd(), "public", SHARE_IMAGE.url.replace(/^\//, ""));

  it("points at a file that is actually in public/", () => {
    expect(existsSync(file), `${file} is missing`).toBe(true);
  });

  it("is a raster format, not an SVG", () => {
    // X, LinkedIn, WhatsApp, Facebook and Discord all drop og:image when it
    // points at an SVG, which is why the 32x32 favicon cannot be reused.
    expect(SHARE_IMAGE.url).not.toMatch(/\.svg$/i);
    expect(SHARE_IMAGE.type).toBe("image/png");
  });

  it("really is a PNG on disk, whatever the extension says", () => {
    const header = readFileSync(file).subarray(0, 8);
    expect([...header]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("declares the dimensions the file actually has", () => {
    // Read straight from the IHDR chunk: a mismatch makes previews crop.
    const bytes = readFileSync(file);
    expect(bytes.readUInt32BE(16)).toBe(SHARE_IMAGE.width);
    expect(bytes.readUInt32BE(20)).toBe(SHARE_IMAGE.height);
  });

  it("is large enough for summary_large_image", () => {
    expect(SHARE_IMAGE.width).toBeGreaterThanOrEqual(300);
    expect(SHARE_IMAGE.height).toBeGreaterThanOrEqual(157);
  });

  it("uses the 1.91:1 card shape, so unfurlers show it uncropped", () => {
    expect(SHARE_IMAGE.width / SHARE_IMAGE.height).toBeCloseTo(1.9, 1);
  });

  it("has alt text, since the card is often read aloud", () => {
    expect(SHARE_IMAGE.alt.trim().length).toBeGreaterThan(0);
  });

  it("uses a root-relative url, so absoluteUrl() can resolve it", () => {
    expect(SHARE_IMAGE.url.startsWith("/")).toBe(true);
  });
});

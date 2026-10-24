#!/usr/bin/env node
/**
 * Generates public/ziki-share.png, the link-preview image (lib/share-image.ts).
 *
 * Unfurlers drop SVG og:images, so the card is rendered to PNG here from the
 * same mark as public/ziki-mark.svg. 1200x630 is the size X, LinkedIn,
 * WhatsApp, Slack and Facebook all crop to without letterboxing.
 *
 *   node scripts/generate-share-image.mjs   (after changing the brand mark)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// sharp ships with Next.js for image optimisation, so nothing extra to install.
const sharp = require(require.resolve("sharp", { paths: [require.resolve("next")] }));

const WIDTH = 1200;
const HEIGHT = 630;
const FONT = "Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif";

// The mark itself, read from public/ so the card follows any change to it.
// Nested as its own <svg> so its viewBox and gradient ids work unchanged.
const MARK_SIZE = 192;
const markSource = readFileSync(new URL("../public/ziki-mark.svg", import.meta.url), "utf8");
const markBody = markSource.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1];
const markViewBox = markSource.match(/viewBox="([^"]+)"/)?.[1];
if (!markBody || !markViewBox) throw new Error("public/ziki-mark.svg has no <svg viewBox> to embed");
const mark = `<svg x="120" y="159" width="${MARK_SIZE}" height="${MARK_SIZE}" viewBox="${markViewBox}" fill="none">${markBody}</svg>`;

const svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="page" x1="0" y1="0" x2="${WIDTH}" y2="${HEIGHT}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F0FDFA"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#page)"/>
  <rect y="${HEIGHT - 12}" width="${WIDTH}" height="12" fill="#0F766E"/>
  ${mark}
  <text x="372" y="292" font-family="${FONT}" font-size="132" font-weight="700" fill="#0F172A" letter-spacing="-3">Ziki</text>
  <text x="378" y="370" font-family="${FONT}" font-size="40" fill="#475569">Resolve issues faster with AI agents</text>
  <text x="378" y="420" font-family="${FONT}" font-size="40" fill="#475569">and human verification.</text>
  <text x="120" y="548" font-family="${FONT}" font-size="34" font-weight="600" fill="#0F766E">ziki.dev</text>
</svg>`;

const out = new URL("../public/ziki-share.png", import.meta.url);
const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
writeFileSync(out, png);
console.log(`Wrote ${out.pathname} (${WIDTH}x${HEIGHT}, ${png.length} bytes)`);

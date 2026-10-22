/**
 * Social/link-preview image.
 *
 * Must be a raster format: X, LinkedIn, WhatsApp, Facebook and Discord all
 * drop `og:image` / `twitter:image` when it points at an SVG. `summary_large_image`
 * also needs at least 300x157, so the 32x32 `/ziki-mark.svg` in `public/` is
 * unsuitable for unfurls — it is only for the in-app favicon.
 *
 * Dimensions must stay in sync with `public/ziki-share.png`, which
 * `scripts/generate-share-image.mjs` renders from that mark.
 */
export const SHARE_IMAGE = {
  url: "/ziki-share.png",
  alt: "Ziki: resolve issues faster with AI agents and human verification",
  width: 1200,
  height: 630,
  type: "image/png",
} as const;

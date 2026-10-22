/**
 * The one content width in the app (#415).
 *
 * The header's inner row and the layout's `<main>` both use this token, so a
 * page's headings and cards share the nav bar's left and right edges at every
 * viewport. Pages must not declare their own `mx-auto max-w-*` wrapper — that
 * is what made one route narrower than the next and inset the content from the
 * nav bar.
 *
 * Prose that needs a shorter line length (the issue description, for example)
 * constrains itself *inside* this container, so the outer border still lines
 * up with the header.
 */
export const PAGE_CONTAINER_CLASS = "mx-auto w-full max-w-6xl px-4";

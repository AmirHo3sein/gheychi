// Plain-text derivation from raw markdown for meta descriptions. Works on the markdown
// source, NOT rendered output. Safety does not hinge on that choice: unhead attribute-escapes
// whatever string ends up in the tag, and the renderer's html:false governs the article body,
// not this string -- the source is simply what's on hand where descriptions are resolved.
// markdown-it decodes HTML entities even with html:false, so the common ones are decoded
// below to match the text readers actually see. Persian-aware: truncation counts code points
// (Array.from), not UTF-16 units, and prefers a word boundary.

/** Google displays roughly 155-160 characters of a meta description. */
const DEFAULT_MAX_LENGTH = 160

/** Entities the renderer would decode in the article body; anything else is stripped. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  zwnj: '\u{200C}',
}

export function markdownToPlainText(src: string, maxLength = DEFAULT_MAX_LENGTH): string {
  const text = src
    // Fenced code blocks (backtick or tilde) vanish entirely -- code is meaningless in a
    // description -- and an unterminated fence swallows everything to the end of the input,
    // exactly as the renderer treats it. Fences go before the inline rules so the ~~
    // strikethrough marker below can never eat a fence's tildes.
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ')
    // Indented code blocks (4 spaces / tab) drop line by line, same rationale as fences.
    .replace(/^(?: {4}|\t).*$/gm, ' ')
    // Link definition lines ([ref]: url ...) are pure metadata -- drop them whole.
    .replace(/^[ \t]*\[[^\]]*\]:.*$/gm, ' ')
    // Images (inline or reference-style) drop entirely; alt text alone reads oddly out of context.
    .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, ' ')
    // Links keep their visible text: inline first, then reference-style, whose empty-ref form
    // also covers collapsed [text][] links.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    // Leading block markers: headings, blockquotes, list bullets/numbers.
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    // Structure-only lines: thematic breaks, setext heading underlines (=== / ---) and table
    // delimiter rows (|---|---|) are all built from =, -, :, | -- drop the whole line.
    .replace(/^[ \t]*(?:[=\-:|][ \t=\-:|]*|\*{3,}|_{3,})[ \t]*$/gm, ' ')
    // Remaining pipes are table cell separators -- spaces, so the cell text survives cleanly.
    .replace(/\|/g, ' ')
    // Emphasis/strikethrough/inline-code markers -- the text between them stays.
    .replace(/\*\*|__|~~|[*_`]/g, '')
    // HTML entities: decode the common ones so the description matches the article text;
    // unrecognized or invalid ones are stripped rather than leaked literally.
    .replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|(\w{1,32}));/g, (_m, hex, dec, name) => {
      if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? ' '
      const cp = hex ? parseInt(hex, 16) : Number(dec)
      const valid = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
      return valid ? String.fromCodePoint(cp) : ' '
    })
    // Raw HTML never renders in articles (html:false), so angle brackets -- literal or freshly
    // decoded above -- are just noise.
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const points = Array.from(text)
  if (points.length <= maxLength) return text

  // Slicing by code points first means the window never splits a surrogate pair; the
  // subsequent lastIndexOf/slice on the window are safe because a space is one UTF-16 unit.
  let cut = points.slice(0, maxLength).join('')
  if (points[maxLength] !== ' ') {
    // Mid-word cut: back off to the last complete word when the window contains one.
    const lastSpace = cut.lastIndexOf(' ')
    if (lastSpace > 0) cut = cut.slice(0, lastSpace)
  }
  return `${cut.trimEnd()}…`
}

/**
 * Meta-description precedence for a blog article: explicit SEO override, then the editorial
 * excerpt, then a plain-text fallback derived from the body. An effectively-empty body yields
 * undefined so the page emits no description tag rather than an empty one.
 */
export function resolveBlogDescription(
  metaDescription: string | null,
  excerpt: string | null,
  bodyMarkdown: string,
): string | undefined {
  return metaDescription ?? excerpt ?? (markdownToPlainText(bodyMarkdown) || undefined)
}

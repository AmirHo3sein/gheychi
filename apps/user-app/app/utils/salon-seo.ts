// Meta-description derivation for the salon profile page. `about` is plain text by design
// (no markdown -- see the salon-showcase spec), so unlike markdown-excerpt.ts this only
// needs whitespace collapsing plus the same Persian-aware truncation: code points
// (Array.from), not UTF-16 units, preferring a word boundary.

/** Google displays roughly 155-160 characters of a meta description. */
const DEFAULT_MAX_LENGTH = 160

export function plainTextExcerpt(text: string, maxLength = DEFAULT_MAX_LENGTH): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()

  const points = Array.from(collapsed)
  if (points.length <= maxLength) return collapsed

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
 * Description precedence for a salon profile: about-excerpt, then tagline, then the legacy
 * description, then a name—address fallback. `||` (not `??`) so an all-whitespace `about`
 * or an empty string falls through instead of emitting a blank description.
 */
export function resolveSalonDescription(salon: {
  name: string
  address: string
  description: string | null
  tagline: string | null
  about: string | null
}): string {
  const aboutExcerpt = salon.about ? plainTextExcerpt(salon.about) : ''
  return aboutExcerpt || salon.tagline || salon.description || `${salon.name} — ${salon.address}`
}

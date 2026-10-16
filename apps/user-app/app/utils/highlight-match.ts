// Splits a salon name around the part the customer typed, for bolding it in the search
// suggestions. Matching mirrors the API's name filter: case-insensitive, and Arabic ي/ك are
// treated as Persian ی/ک (the fold is one character for one, so indices map straight back
// onto the original name). Only the first occurrence is marked -- enough to show "why this
// result", without striping a name that repeats a short fragment.
export interface MatchPart {
  text: string
  match: boolean
}

function fold(value: string): string {
  return value.replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase()
}

export function highlightMatch(name: string, query: string): MatchPart[] {
  const q = fold(query.trim())
  if (!q) return [{ text: name, match: false }]
  const at = fold(name).indexOf(q)
  if (at === -1) return [{ text: name, match: false }]
  return [
    { text: name.slice(0, at), match: false },
    { text: name.slice(at, at + q.length), match: true },
    { text: name.slice(at + q.length), match: false },
  ].filter((p) => p.text !== '')
}

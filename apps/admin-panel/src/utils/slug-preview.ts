// apps/admin-panel/src/utils/slug-preview.ts
// Client-side *preview* of the slug the backend derives from a title. The authoritative slug
// is generated server-side on create (apps/api/src/common/slug.util.ts adds a random
// uniqueness suffix); this helper only fills the editor's slug field until the admin edits it
// manually. Transliteration-free by design: Persian letters (U+0600–U+06FF, which includes
// Persian digits) are kept as-is -- URLs percent-encode them -- Latin is lowercased, and every
// other run of characters (spaces, ZWNJ, punctuation) collapses to a single dash.
export function previewSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// «عضو قیچی از مهر ۱۴۰۵» -- the honest replacement for a "verified salon" claim: it states
// only the fact we actually hold (when the salon joined). Persian calendar, Tehran time zone,
// pieces assembled by type so the field order never depends on ICU locale data.
const format = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Tehran',
})

export function formatMemberSince(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts = Object.fromEntries(format.formatToParts(d).map((p) => [p.type, p.value]))
  if (!parts.month || !parts.year) return null
  return `عضو قیچی از ${parts.month} ${parts.year}`
}

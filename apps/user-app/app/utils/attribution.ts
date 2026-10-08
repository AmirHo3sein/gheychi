// Marketing-channel attribution (Phase 4 of the monetization initiative -- see
// docs/technical-overview/31-public-handle-and-attribution.md). Resolved once, client-side,
// on the salon profile page and carried through to the booking page via a query param on the
// internal "Book" link -- no server round trip, no sessionStorage, since the salon profile
// page is always the entry point (the QR/shareable link points there, never straight at a
// booking page). Mirrors CreateBookingDto.attributionSource's fixed value set exactly.
export type AttributionSource = 'qr' | 'direct' | 'search'

const SEARCH_ENGINE_HOST_FRAGMENTS = ['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'yandex.']

/**
 * `querySource` is whatever `?source=` the salon page itself was opened with -- only 'qr'
 * and 'direct' are accepted from it (the two values this platform's own share/QR features
 * ever generate); anything else is ignored rather than trusted verbatim, since the query
 * string is attacker/customer-controlled. `referrer` is `document.referrer`, checked only
 * when no explicit query value was given -- a search-engine referrer client-side-detects
 * "search" without needing any server-side logging.
 */
export function resolveAttributionSource(querySource: unknown, referrer: string): AttributionSource | null {
  if (querySource === 'qr' || querySource === 'direct') return querySource
  if (referrer) {
    try {
      const host = new URL(referrer).hostname
      if (SEARCH_ENGINE_HOST_FRAGMENTS.some((fragment) => host.includes(fragment))) return 'search'
    } catch {
      // Malformed/opaque referrer -- nothing attributable.
    }
  }
  return null
}

/**
 * The one place a "Book this service" link is built from a salon page, so every entry point
 * on it (the service list, a story's booking pill, a portfolio lightbox's booking pill)
 * carries the same resolved attribution -- a story/portfolio pill that linked straight to
 * `/booking/...` silently dropped the `?source=` a QR scan had landed with, and the booking
 * then recorded as unattributed.
 */
export function buildBookingLink(
  slug: string,
  serviceId: string,
  attributionSource: AttributionSource | null | undefined,
  // A Beauty Guide this booking starts from (the customer's own) -- carried so the salon can
  // see the inspiration attached to the booking. Pure context; never affects price/slots.
  options: { beautyGuideId?: string } = {},
): string {
  const params = new URLSearchParams()
  if (attributionSource) params.set('source', attributionSource)
  if (options.beautyGuideId) params.set('beautyGuideId', options.beautyGuideId)
  const query = params.toString()
  const base = `/booking/${slug}/${serviceId}`
  return query ? `${base}?${query}` : base
}

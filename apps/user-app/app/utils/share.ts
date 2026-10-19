// «اشتراک‌گذاری» for a salon page: the native share sheet where the device has one (most
// phones), and a copy-to-clipboard fallback everywhere else (most desktops). The caller turns
// the outcome into feedback -- a toast for "copied", nothing for a share the OS already
// confirmed or the customer dismissed.
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unavailable'

export interface SharePayload {
  title: string
  text?: string
  url: string
}

// The two pieces of `navigator` this needs, injectable so the decision tree is unit-testable
// without a browser.
export interface ShareEnvironment {
  share?: (data: SharePayload) => Promise<void>
  canShare?: (data: SharePayload) => boolean
  clipboard?: { writeText: (text: string) => Promise<void> }
}

export async function shareLink(payload: SharePayload, env: ShareEnvironment | undefined): Promise<ShareOutcome> {
  if (env?.share && (!env.canShare || env.canShare(payload))) {
    try {
      await env.share(payload)
      return 'shared'
    } catch (err) {
      // The customer closed the sheet -- respect that, don't silently copy instead.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      // Anything else (NotAllowedError outside a user gesture, an in-app browser that exposes
      // share() but refuses it) falls through to the clipboard.
    }
  }
  if (env?.clipboard?.writeText) {
    try {
      await env.clipboard.writeText(payload.url)
      return 'copied'
    } catch {
      return 'unavailable'
    }
  }
  return 'unavailable'
}

/**
 * The salon's public link with `?source=direct`, the attribution value this platform's own
 * share feature generates (see utils/attribution.ts -- only 'qr' and 'direct' are trusted from
 * the query string). Built from the current origin so it is right in every environment.
 */
export function salonShareUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, '')}/salons/${encodeURIComponent(slug)}?source=direct`
}

/**
 * The link a salon QR code carries: the public page with `?source=qr`, the same payload the
 * provider panel's printable QR uses (PublicLinkCard.vue), so a booking that starts from a
 * scan is attributed the same way wherever the code was shown.
 */
export function salonQrUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, '')}/salons/${encodeURIComponent(slug)}?source=qr`
}

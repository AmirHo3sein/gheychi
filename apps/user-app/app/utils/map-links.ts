// Shared by SalonMap.client.vue's own marker popup and salons/[slug].vue's directions
// buttons, so both places building a link to the same coordinates can never drift into two
// different URL formats.
//
// Iran-friendly directions: nshn.ir opens the Neshan app if installed (else its web map), a
// domestically-hosted service that works reliably inside Iran. Google Maps is offered as a
// second option since some users prefer it -- it needs no API key either (a plain
// https://www.google.com/maps/dir/ URL, not the paid Directions API).
export function neshanUrl(lat: number, lng: number): string {
  return `https://nshn.ir/?lat=${lat}&lng=${lng}`
}

export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

// Tile provider is configuration, not code: switching away from OpenStreetMap's volunteer-run
// standard tiles (light-use policy only) is NUXT_PUBLIC_MAP_TILE_URL/_ATTRIBUTION plus a CSP
// `img-src` line, with no rebuild. Pure so the resolution rules are unit-testable without a
// Nuxt context.
export const DEFAULT_MAP_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const DEFAULT_MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export interface MapTileConfig {
  url: string
  attribution: string
}

// A tile template Leaflet can actually fill: https only (the app is served over https and
// mixed-content tiles are blocked) and carrying all three tile coordinates. Anything else is
// a misconfiguration, so fall back to the default rather than ship a blank map.
function isUsableTileUrl(url: string): boolean {
  return /^https:\/\//.test(url) && url.includes('{z}') && url.includes('{x}') && url.includes('{y}')
}

export function resolveMapTileConfig(raw: { mapTileUrl?: unknown; mapTileAttribution?: unknown }): MapTileConfig {
  const url = typeof raw.mapTileUrl === 'string' ? raw.mapTileUrl.trim() : ''
  if (!isUsableTileUrl(url)) {
    return { url: DEFAULT_MAP_TILE_URL, attribution: DEFAULT_MAP_TILE_ATTRIBUTION }
  }
  const attribution = typeof raw.mapTileAttribution === 'string' ? raw.mapTileAttribution.trim() : ''
  // A custom provider with no attribution of its own must not silently inherit OSM's credit.
  return { url, attribution }
}

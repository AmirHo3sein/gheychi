// OpenStreetMap's standard tiles by default. OSM's tile policy
// (operations.osmfoundation.org/policies/tiles) allows light use with attribution only, so
// moving to a paid/self-hosted provider is configuration (VITE_MAP_TILE_URL /
// VITE_MAP_TILE_ATTRIBUTION) plus the Caddyfile img-src line, not a code change.
const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const DEFAULT_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export interface MapTileConfig {
  url: string
  attribution: string
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// Takes import.meta.env as-is (its type has no index for our optional keys).
export function resolveMapTiles(env: object): MapTileConfig {
  const e = env as Record<string, unknown>
  const url = str(e.VITE_MAP_TILE_URL)
  // A custom URL without its own attribution must not silently inherit OSM's credit line
  // (wrong provider), and a custom attribution without a URL has nothing to attach to.
  if (!url) return { url: DEFAULT_TILE_URL, attribution: DEFAULT_ATTRIBUTION }
  return { url, attribution: str(e.VITE_MAP_TILE_ATTRIBUTION) }
}

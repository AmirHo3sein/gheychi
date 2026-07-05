// PostGIS/GeoJSON `Point` coordinates are `[longitude, latitude]` -- the opposite
// order from the `{ lat, lng }` shape the rest of the app (and Leaflet) expects.
// Isolated in its own function so the unpack order is locked in by a test rather
// than re-transposed by a future edit to the inline call site.
export function geoJsonToLatLng(coordinates: [number, number]): { lat: number; lng: number } {
  return { lat: coordinates[1], lng: coordinates[0] }
}

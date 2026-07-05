import { describe, it, expect } from 'vitest'
import { geoJsonToLatLng } from '../../app/utils/geo'

describe('geoJsonToLatLng', () => {
  it('swaps GeoJSON [lng, lat] into { lat, lng }', () => {
    expect(geoJsonToLatLng([51.39, 35.69])).toEqual({ lat: 35.69, lng: 51.39 })
  })
})

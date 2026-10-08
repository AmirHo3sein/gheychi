import { describe, expect, it } from 'vitest'
import { resolveMapTiles } from './map-tiles'

describe('resolveMapTiles', () => {
  it('defaults to OpenStreetMap with its attribution when nothing is configured', () => {
    const t = resolveMapTiles({})
    expect(t.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(t.attribution).toContain('OpenStreetMap')
  })
  it('treats empty strings (an unset CI variable) as absent', () => {
    expect(resolveMapTiles({ VITE_MAP_TILE_URL: '  ', VITE_MAP_TILE_ATTRIBUTION: 'x' }).url).toContain('openstreetmap')
  })
  it('uses the configured provider and does not inherit the OSM credit line', () => {
    expect(resolveMapTiles({ VITE_MAP_TILE_URL: 'https://t.example/{z}/{x}/{y}.png' })).toEqual({
      url: 'https://t.example/{z}/{x}/{y}.png',
      attribution: '',
    })
    expect(resolveMapTiles({ VITE_MAP_TILE_URL: 'https://t.example/{z}/{x}/{y}.png', VITE_MAP_TILE_ATTRIBUTION: '© Ex' }).attribution).toBe('© Ex')
  })
})

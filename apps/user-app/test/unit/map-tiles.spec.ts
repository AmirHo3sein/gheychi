import { describe, it, expect } from 'vitest'
import { DEFAULT_MAP_TILE_ATTRIBUTION, DEFAULT_MAP_TILE_URL, resolveMapTileConfig } from '../../app/utils/map-tiles'

describe('resolveMapTileConfig', () => {
  it('defaults to OpenStreetMap when nothing is configured', () => {
    expect(resolveMapTileConfig({})).toEqual({ url: DEFAULT_MAP_TILE_URL, attribution: DEFAULT_MAP_TILE_ATTRIBUTION })
    expect(resolveMapTileConfig({ mapTileUrl: '', mapTileAttribution: '' }).url).toBe(DEFAULT_MAP_TILE_URL)
    expect(DEFAULT_MAP_TILE_URL).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
  })

  it('uses a configured https template and its own attribution', () => {
    const cfg = resolveMapTileConfig({
      mapTileUrl: ' https://tiles.example.com/{z}/{x}/{y}.png ',
      mapTileAttribution: ' &copy; Example ',
    })
    expect(cfg).toEqual({ url: 'https://tiles.example.com/{z}/{x}/{y}.png', attribution: '&copy; Example' })
  })

  it('never lets a custom provider inherit OpenStreetMap\'s credit', () => {
    expect(resolveMapTileConfig({ mapTileUrl: 'https://t.example/{z}/{x}/{y}.png' }).attribution).toBe('')
  })

  it.each([
    ['http://t.example/{z}/{x}/{y}.png'],
    ['https://t.example/tiles.png'],
    ['https://t.example/{z}/{x}.png'],
    [42],
  ])('falls back to the default for an unusable template (%s), attribution included', (bad) => {
    expect(resolveMapTileConfig({ mapTileUrl: bad, mapTileAttribution: 'x' })).toEqual({
      url: DEFAULT_MAP_TILE_URL,
      attribution: DEFAULT_MAP_TILE_ATTRIBUTION,
    })
  })
})

import { describe, expect, it } from 'vitest'
import { buildBookingLink, resolveAttributionSource } from '../../app/utils/attribution'

describe('resolveAttributionSource', () => {
  it('accepts an explicit qr query source', () => {
    expect(resolveAttributionSource('qr', '')).toBe('qr')
  })

  it('accepts an explicit direct query source', () => {
    expect(resolveAttributionSource('direct', '')).toBe('direct')
  })

  it('ignores an unrecognized query source value', () => {
    expect(resolveAttributionSource('facebook-ads', '')).toBeNull()
  })

  it('detects a search-engine referrer when no query source is given', () => {
    expect(resolveAttributionSource(undefined, 'https://www.google.com/search?q=salon')).toBe('search')
    expect(resolveAttributionSource(undefined, 'https://www.bing.com/search?q=salon')).toBe('search')
  })

  it('a query source always wins over a search-engine referrer', () => {
    expect(resolveAttributionSource('qr', 'https://www.google.com/search?q=salon')).toBe('qr')
  })

  it('returns null for a non-search referrer (organic in-app navigation)', () => {
    expect(resolveAttributionSource(undefined, 'https://gheychi.co/')).toBeNull()
  })

  it('returns null with no query source and no referrer', () => {
    expect(resolveAttributionSource(undefined, '')).toBeNull()
  })

  it('does not throw on a malformed referrer', () => {
    expect(resolveAttributionSource(undefined, 'not-a-url')).toBeNull()
  })
})

describe('buildBookingLink', () => {
  it('appends ?source= when an attribution was resolved', () => {
    expect(buildBookingLink('my-salon', 'svc1', 'qr')).toBe('/booking/my-salon/svc1?source=qr')
    expect(buildBookingLink('my-salon', 'svc1', 'search')).toBe('/booking/my-salon/svc1?source=search')
  })

  it('leaves the link bare when there is nothing to attribute', () => {
    expect(buildBookingLink('my-salon', 'svc1', null)).toBe('/booking/my-salon/svc1')
    expect(buildBookingLink('my-salon', 'svc1', undefined)).toBe('/booking/my-salon/svc1')
  })

  it('carries an optional beautyGuideId alongside (or without) the attribution source', () => {
    const guide = '0b6c1e57-2f0a-4c1e-9b1e-1d2c3e4f5a6b'
    expect(buildBookingLink('my-salon', 'svc1', null, { beautyGuideId: guide })).toBe(`/booking/my-salon/svc1?beautyGuideId=${guide}`)
    expect(buildBookingLink('my-salon', 'svc1', 'qr', { beautyGuideId: guide })).toBe(`/booking/my-salon/svc1?source=qr&beautyGuideId=${guide}`)
  })
})

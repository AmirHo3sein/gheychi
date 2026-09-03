import { describe, it, expect } from 'vitest'
import { buildCanonicalUrl } from '../../app/utils/canonical-url'

const SITE = 'https://gheychi.co'

describe('buildCanonicalUrl', () => {
  it('renders the site root as a single trailing slash', () => {
    expect(buildCanonicalUrl(SITE, '/')).toBe('https://gheychi.co/')
    expect(buildCanonicalUrl(SITE, '')).toBe('https://gheychi.co/')
  })

  it('tolerates a trailing slash on the configured site url', () => {
    expect(buildCanonicalUrl('https://gheychi.co/', '/salons')).toBe('https://gheychi.co/salons')
  })

  it('normalises a path with or without its leading slash to the same url', () => {
    expect(buildCanonicalUrl(SITE, 'salons')).toBe(buildCanonicalUrl(SITE, '/salons'))
  })

  it('strips a trailing slash from a path so /salons and /salons/ never both appear', () => {
    expect(buildCanonicalUrl(SITE, '/salons/')).toBe('https://gheychi.co/salons')
  })

  // The load-bearing behaviour: a canonical claims ONE url owns the content, so a param left
  // at its default (or explicitly empty) must be absent from it, not present-and-empty.
  it('drops undefined, null and empty-string params', () => {
    expect(buildCanonicalUrl(SITE, '/salons', { gender: undefined, city: null, cursor: '' }))
      .toBe('https://gheychi.co/salons')
  })

  it('keeps params that carry a real value', () => {
    expect(buildCanonicalUrl(SITE, '/salons', { gender: 'men', city: 'mashhad' }))
      .toBe('https://gheychi.co/salons?gender=men&city=mashhad')
  })

  it('keeps a numeric zero rather than treating it as absent', () => {
    expect(buildCanonicalUrl(SITE, '/blog', { page: 0 })).toBe('https://gheychi.co/blog?page=0')
  })

  it('percent-encodes a non-ASCII param value (Persian category slugs are possible)', () => {
    const url = buildCanonicalUrl(SITE, '/blog', { category: 'مو' })
    expect(url).toBe('https://gheychi.co/blog?category=%D9%85%D9%88')
    // Round-trips back to the original value rather than being mangled.
    expect(new URL(url).searchParams.get('category')).toBe('مو')
  })

  it('percent-encodes a value containing an ampersand instead of splitting the query', () => {
    const url = buildCanonicalUrl(SITE, '/blog', { category: 'a&b=c' })
    expect(new URL(url).searchParams.get('category')).toBe('a&b=c')
  })
})

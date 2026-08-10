import { describe, it, expect } from 'vitest'
import {
  buildSitemapIndexXml,
  buildUrlsetXml,
  computeSitemapPageCount,
  MAX_SITEMAP_PAGES,
  parsePageFromSitemapPath,
  parsePageParam,
} from '../../server/utils/sitemap'

describe('buildUrlsetXml', () => {
  it('emits one <url> per entry with the sitemap namespace', () => {
    const xml = buildUrlsetXml([{ loc: 'https://example.com/salons/rose-beauty', changefreq: 'weekly', priority: 0.8 }])
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<loc>https://example.com/salons/rose-beauty</loc>')
    expect(xml).toContain('<changefreq>weekly</changefreq>')
    expect(xml).toContain('<priority>0.8</priority>')
  })

  it('omits lastmod/changefreq/priority entirely when not provided', () => {
    const xml = buildUrlsetXml([{ loc: 'https://example.com/salons/rose-beauty' }])
    expect(xml).not.toContain('<lastmod>')
    expect(xml).not.toContain('<changefreq>')
    expect(xml).not.toContain('<priority>')
  })

  it('includes lastmod when provided (blog posts)', () => {
    const xml = buildUrlsetXml([{ loc: 'https://example.com/blog/a', lastmod: '2026-07-09T10:00:00.000Z' }])
    expect(xml).toContain('<lastmod>2026-07-09T10:00:00.000Z</lastmod>')
  })

  it('produces a valid, empty urlset for a zero-entry page (out-of-range page, or zero rows)', () => {
    const xml = buildUrlsetXml([])
    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>')
  })

  it('escapes XML-significant characters in loc', () => {
    const xml = buildUrlsetXml([{ loc: "https://example.com/salons/a&b<c>\"d'" }])
    expect(xml).toContain('<loc>https://example.com/salons/a&amp;b&lt;c&gt;&quot;d&apos;</loc>')
  })
})

describe('buildSitemapIndexXml', () => {
  it('lists one <sitemap> entry per loc', () => {
    const xml = buildSitemapIndexXml(['https://example.com/sitemap-salons-1.xml', 'https://example.com/sitemap-posts-1.xml'])
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<sitemap><loc>https://example.com/sitemap-salons-1.xml</loc></sitemap>')
    expect(xml).toContain('<sitemap><loc>https://example.com/sitemap-posts-1.xml</loc></sitemap>')
  })
})

describe('parsePageParam', () => {
  it('parses a positive integer string', () => {
    expect(parsePageParam('1')).toBe(1)
    expect(parsePageParam('42')).toBe(42)
  })

  it('rejects missing, non-numeric, zero, negative, and decimal values as null', () => {
    expect(parsePageParam(undefined)).toBeNull()
    expect(parsePageParam('')).toBeNull()
    expect(parsePageParam('abc')).toBeNull()
    expect(parsePageParam('0')).toBeNull()
    expect(parsePageParam('-1')).toBeNull()
    expect(parsePageParam('1.5')).toBeNull()
    expect(parsePageParam('01')).toBeNull()
  })
})

describe('computeSitemapPageCount', () => {
  it('returns 1 page for zero rows (an empty sitemap is still a valid one to list)', () => {
    expect(computeSitemapPageCount(0, 5_000)).toBe(1)
  })

  it('returns 1 page when total fits exactly within one page', () => {
    expect(computeSitemapPageCount(5_000, 5_000)).toBe(1)
  })

  it('rounds up to a second page for a single row over the page size', () => {
    expect(computeSitemapPageCount(5_001, 5_000)).toBe(2)
  })

  it('computes however many pages currently exist for a larger, real total', () => {
    expect(computeSitemapPageCount(12_000, 5_000)).toBe(3)
  })

  it('clamps to MAX_SITEMAP_PAGES so the index never lists an unregistered page', () => {
    expect(computeSitemapPageCount(MAX_SITEMAP_PAGES * 5_000, 5_000)).toBe(MAX_SITEMAP_PAGES)
    expect(computeSitemapPageCount((MAX_SITEMAP_PAGES + 1) * 5_000, 5_000)).toBe(MAX_SITEMAP_PAGES)
  })
})

describe('parsePageFromSitemapPath', () => {
  it('extracts the page number for a matching prefix', () => {
    expect(parsePageFromSitemapPath('/sitemap-salons-1.xml', 'sitemap-salons')).toBe(1)
    expect(parsePageFromSitemapPath('/sitemap-posts-42.xml', 'sitemap-posts')).toBe(42)
  })

  it('returns null for a mismatched prefix, missing number, or non-.xml suffix', () => {
    expect(parsePageFromSitemapPath('/sitemap-posts-1.xml', 'sitemap-salons')).toBeNull()
    expect(parsePageFromSitemapPath('/sitemap-salons-.xml', 'sitemap-salons')).toBeNull()
    expect(parsePageFromSitemapPath('/sitemap-salons-1.json', 'sitemap-salons')).toBeNull()
  })
})

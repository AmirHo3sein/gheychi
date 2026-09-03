import { describe, it, expect } from 'vitest'
import { buildRobotsTxt } from '../../server/utils/robots'

const SITE = 'https://gheychi.co'

describe('buildRobotsTxt', () => {
  // The whole reason robots.txt stopped being a static public/ file: Google ignores a
  // relative Sitemap: directive outright, so the old `Sitemap: /sitemap.xml` meant the
  // sitemap index was never discovered through robots.txt at all.
  it('emits an ABSOLUTE Sitemap directive built from the configured site url', () => {
    expect(buildRobotsTxt(SITE)).toContain('Sitemap: https://gheychi.co/sitemap.xml')
  })

  it('never emits a relative Sitemap path', () => {
    expect(buildRobotsTxt(SITE)).not.toMatch(/^Sitemap: \//m)
  })

  it('does not double the slash when the configured site url has a trailing one', () => {
    expect(buildRobotsTxt('https://gheychi.co/')).toContain('Sitemap: https://gheychi.co/sitemap.xml')
  })

  // The gap this list exists to close: wallet/referral/activity/favorites all live under
  // /account/ and were fully crawlable.
  it('disallows the private per-user account section', () => {
    expect(buildRobotsTxt(SITE)).toMatch(/^Disallow: \/account\/$/m)
  })

  it('keeps every previously-disallowed private path', () => {
    const txt = buildRobotsTxt(SITE)
    for (const path of ['/admin/', '/bookings', '/booking/', '/profile']) {
      expect(txt).toMatch(new RegExp(`^Disallow: ${path.replace(/\//g, '\\/')}$`, 'm'))
    }
  })

  // `/bookings` has no trailing slash on purpose (robots.txt prefix-matches, so it must cover
  // /bookings/:id too) while `/booking/` keeps its slash so it can't also swallow /bookings.
  it('covers the booking detail route via the slash-less /bookings prefix', () => {
    const txt = buildRobotsTxt(SITE)
    expect(txt).toContain('Disallow: /bookings\n')
    expect(txt).not.toContain('Disallow: /bookings/\n')
  })

  it('keeps the public salon surface crawlable', () => {
    const txt = buildRobotsTxt(SITE)
    expect(txt).toMatch(/^Allow: \/$/m)
    expect(txt).toMatch(/^Allow: \/salons\/$/m)
    // The listing page and every salon profile must not be caught by any Disallow line.
    expect(txt).not.toMatch(/^Disallow: \/salons/m)
    expect(txt).not.toMatch(/^Disallow: \/blog/m)
  })

  it('starts with a wildcard user-agent group', () => {
    expect(buildRobotsTxt(SITE).split('\n')[0]).toBe('User-agent: *')
  })
})

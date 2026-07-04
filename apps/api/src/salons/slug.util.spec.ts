import { makeSlug } from './slug.util';

describe('makeSlug', () => {
  it('slugifies latin names and appends a 4-hex suffix', () => {
    const slug = makeSlug('VIP Beauty Salon');
    expect(slug).toMatch(/^vip-beauty-salon-[0-9a-f]{4}$/);
  });

  it('falls back to salon-<hex> for non-latin (Persian) names', () => {
    const slug = makeSlug('سالن رز');
    expect(slug).toMatch(/^salon-[0-9a-f]{8}$/);
  });

  it('generates unique slugs for the same name', () => {
    expect(makeSlug('Rose')).not.toBe(makeSlug('Rose'));
  });
});

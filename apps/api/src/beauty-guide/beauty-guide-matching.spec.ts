import { CandidateServiceRow, MAX_MATCHED_SALONS, rankMatches } from './beauty-guide-matching';

const COLOR = 2;
const CUT = 1;
const concepts = [
  { key: 'balayage', categoryId: COLOR, keywords: ['بالیاژ', 'balayage'] },
  { key: 'root_melt', categoryId: COLOR, keywords: ['روت ملت'] },
  { key: 'layered_cut', categoryId: CUT, keywords: ['لایه'] },
];

function row(over: Partial<CandidateServiceRow>): CandidateServiceRow {
  return {
    salonId: 's1', salonName: 'S1', slug: 's1', city: 'تهران', address: 'x', ratingAvg: 4, ratingCount: 10,
    distanceKm: 2, coverPhoto: null, hasActiveStory: false, serviceId: 'sv1', serviceName: 'رنگ', serviceDescription: null,
    categoryId: COLOR, pricingType: 'fixed', price: 1_000_000, priceMax: null, discountPercent: null, durationMin: 60,
    durationMax: null, hasPortfolio: false, ...over,
  };
}

describe('rankMatches', () => {
  it('ranks by concept coverage, then keyword, portfolio, rating, distance', () => {
    const result = rankMatches(
      [
        row({ salonId: 'near', slug: 'near', distanceKm: 1 }),
        row({ salonId: 'both', slug: 'both', distanceKm: 9, serviceId: 'a' }),
        row({ salonId: 'both', slug: 'both', distanceKm: 9, serviceId: 'b', categoryId: CUT }),
        row({ salonId: 'kw', slug: 'kw', distanceKm: 5, serviceName: 'بالیاژ فرانسوی' }),
      ],
      concepts,
      true,
    );
    expect(result.map((r) => r.salon.slug)).toEqual(['both', 'near', 'kw']);
    // 'near' and 'kw' tie on coverage (category-level match covers both color concepts for
    // 'near'; the keyword narrows 'kw' to balayage only) -- coverage wins over keyword.
  });

  it('prefers a keyword match when coverage ties', () => {
    const result = rankMatches(
      [row({ salonId: 'plain', slug: 'plain', distanceKm: 1, categoryId: CUT }), row({ salonId: 'kw', slug: 'kw', distanceKm: 8, categoryId: CUT, serviceName: 'کوتاهی لایه‌ای' })],
      concepts,
      true,
    );
    expect(result.map((r) => r.salon.slug)).toEqual(['kw', 'plain']);
    expect(result[0].services[0].keywordMatch).toBe(true);
    expect(result[0].services[0].conceptKeys).toEqual(['layered_cut']);
  });

  it('marks only fixed-price services as bookable online and keeps real pricing untouched', () => {
    const result = rankMatches(
      [
        row({ serviceId: 'q', pricingType: 'quote', price: null }),
        row({ serviceId: 'r', pricingType: 'range', price: 2_000_000, priceMax: 3_500_000 }),
        row({ serviceId: 'f', pricingType: 'fixed', price: 2_500_000, discountPercent: 10 }),
      ],
      concepts,
      true,
    );
    const services = result[0].services;
    expect(services.find((s) => s.id === 'q')).toMatchObject({ bookableOnline: false, price: null });
    expect(services.find((s) => s.id === 'r')).toMatchObject({ bookableOnline: false, price: 2_000_000, priceMax: 3_500_000 });
    expect(services.find((s) => s.id === 'f')).toMatchObject({ bookableOnline: true, price: 2_500_000, discountPercent: 10 });
    // Card floor: discounted fixed (2,250,000) vs range floor (2,000,000) → 2,000,000. Quote contributes nothing.
    expect(result[0].salon.minPrice).toBe(2_000_000);
  });

  it('ignores rows whose category no effective concept maps to', () => {
    expect(rankMatches([row({ categoryId: 99 })], concepts, true)).toEqual([]);
  });

  it('hides ratings entirely when reviews are disabled', () => {
    const [r] = rankMatches([row({ ratingAvg: 4.8, ratingCount: 99 })], concepts, false);
    expect(r.salon).toMatchObject({ ratingAvg: 0, ratingCount: 0 });
  });

  it('caps the number of salons', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ salonId: `s${i}`, slug: `s${i}`, serviceId: `v${i}` }));
    expect(rankMatches(rows, concepts, true)).toHaveLength(MAX_MATCHED_SALONS);
  });
});

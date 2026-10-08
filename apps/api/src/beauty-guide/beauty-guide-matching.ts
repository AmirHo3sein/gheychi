import { BeautyConcept } from './beauty-concept.entity';

/**
 * Pure ranking for Beauty Guide matches -- no I/O, so the "deterministic and explainable"
 * requirement is unit-testable. Inputs are rows already filtered by SQL to: active
 * services in a mapped category, at approved salons whose gender target matches the
 * customer, within the requested radius. Nothing here can widen that set; it only orders
 * and trims it.
 */
export interface CandidateServiceRow {
  salonId: string;
  salonName: string;
  slug: string;
  city: string;
  address: string;
  ratingAvg: number;
  ratingCount: number;
  distanceKm: number;
  coverPhoto: string | null;
  hasActiveStory: boolean;
  serviceId: string;
  serviceName: string;
  serviceDescription: string | null;
  categoryId: number;
  pricingType: 'fixed' | 'from' | 'range' | 'quote';
  price: number | null;
  priceMax: number | null;
  discountPercent: number | null;
  durationMin: number;
  durationMax: number | null;
  hasPortfolio: boolean;
}

export interface MatchedService {
  id: string;
  name: string;
  pricingType: CandidateServiceRow['pricingType'];
  price: number | null;
  priceMax: number | null;
  discountPercent: number | null;
  durationMin: number;
  durationMax: number | null;
  /** Concept keys this service is matched to (via its category). */
  conceptKeys: string[];
  /** True when the service name/description literally mentions a concept keyword. */
  keywordMatch: boolean;
  /** Only fixed-price services can be booked online (createHold rejects the rest). */
  bookableOnline: boolean;
}

export interface MatchedSalon {
  salon: {
    id: string;
    name: string;
    slug: string;
    city: string;
    address: string;
    ratingAvg: number;
    ratingCount: number;
    distanceKm: number;
    minPrice: number | null;
    coverPhoto: string | null;
    isFeatured: false;
    hasActiveStory: boolean;
    categories: Array<{ id: number; name: string; icon: string }>;
  };
  services: MatchedService[];
  /** Human-readable reasons, for the "why this salon" line. */
  matchedConceptKeys: string[];
}

export const MAX_MATCHED_SALONS = 20;
const MAX_SERVICES_PER_SALON = 4;

function containsKeyword(text: string, keywords: string[]): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((k) => k.trim() && haystack.includes(k.trim().toLowerCase()));
}

/** Mirrors applyDiscount() / search's SQL: the honest "from" figure on a salon card. */
function effectiveFloor(row: Pick<CandidateServiceRow, 'pricingType' | 'price' | 'discountPercent'>): number | null {
  if (row.price === null) return null;
  if (row.pricingType === 'fixed') return Math.round((row.price * (100 - (row.discountPercent ?? 0))) / 100);
  return row.price;
}

export function rankMatches(
  rows: CandidateServiceRow[],
  concepts: Pick<BeautyConcept, 'key' | 'categoryId' | 'keywords'>[],
  reviewsEnabled: boolean,
): MatchedSalon[] {
  const bySalon = new Map<string, { base: CandidateServiceRow; services: MatchedService[]; portfolio: boolean }>();
  for (const row of rows) {
    const related = concepts.filter((c) => c.categoryId === row.categoryId);
    if (related.length === 0) continue;
    const text = `${row.serviceName} ${row.serviceDescription ?? ''}`;
    const keywordConcepts = related.filter((c) => containsKeyword(text, c.keywords));
    const entry = bySalon.get(row.salonId) ?? { base: row, services: [], portfolio: false };
    entry.portfolio ||= row.hasPortfolio;
    entry.services.push({
      id: row.serviceId,
      name: row.serviceName,
      pricingType: row.pricingType,
      price: row.price,
      priceMax: row.priceMax,
      discountPercent: row.discountPercent,
      durationMin: row.durationMin,
      durationMax: row.durationMax,
      // A keyword hit narrows the service to the concepts it actually names; otherwise the
      // service matches every concept sharing its category (category-level precision only).
      conceptKeys: (keywordConcepts.length ? keywordConcepts : related).map((c) => c.key),
      keywordMatch: keywordConcepts.length > 0,
      bookableOnline: row.pricingType === 'fixed',
    });
    bySalon.set(row.salonId, entry);
  }

  const scored = [...bySalon.values()].map(({ base, services, portfolio }) => {
    services.sort((a, b) => Number(b.keywordMatch) - Number(a.keywordMatch) || Number(b.bookableOnline) - Number(a.bookableOnline));
    const conceptKeys = [...new Set(services.flatMap((s) => s.conceptKeys))];
    const floors = services.map((s) => effectiveFloor(s)).filter((p): p is number => p !== null);
    return {
      coverage: conceptKeys.length,
      keyword: services.some((s) => s.keywordMatch) ? 1 : 0,
      portfolio: portfolio ? 1 : 0,
      rating: reviewsEnabled ? base.ratingAvg : 0,
      distance: base.distanceKm,
      result: {
        salon: {
          id: base.salonId,
          name: base.salonName,
          slug: base.slug,
          city: base.city,
          address: base.address,
          ratingAvg: reviewsEnabled ? base.ratingAvg : 0,
          ratingCount: reviewsEnabled ? base.ratingCount : 0,
          distanceKm: base.distanceKm,
          minPrice: floors.length ? Math.min(...floors) : null,
          coverPhoto: base.coverPhoto,
          isFeatured: false as const,
          hasActiveStory: base.hasActiveStory,
          categories: [],
        },
        services: services.slice(0, MAX_SERVICES_PER_SALON),
        matchedConceptKeys: conceptKeys,
      } satisfies MatchedSalon,
    };
  });

  // Explainable lexicographic order: covers more of the look → names the technique →
  // shows matching work → better rated → closer. No featured/paid boost in V1.
  scored.sort(
    (a, b) =>
      b.coverage - a.coverage ||
      b.keyword - a.keyword ||
      b.portfolio - a.portfolio ||
      b.rating - a.rating ||
      a.distance - b.distance,
  );
  return scored.slice(0, MAX_MATCHED_SALONS).map((s) => s.result);
}

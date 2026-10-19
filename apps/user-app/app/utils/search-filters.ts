// Home-page search filters beyond category/sort: the search radius and a price band, both
// real /search parameters (SearchQueryDto.radiusKm / priceMin / priceMax).

export interface SearchFilters {
  radiusKm: number
  priceMin: number | null
  priceMax: number | null
}

/** The API's own default when radiusKm is absent (search.service.ts). */
export const DEFAULT_RADIUS_KM = 15
export const RADIUS_OPTIONS = [3, 5, 10, 15, 25, 50] as const
/** MAX_PRICE_TOMAN on the API (common/money-limits.ts); anything larger is a 400. */
export const MAX_SEARCH_PRICE = 1_000_000_000

export const DEFAULT_FILTERS: SearchFilters = { radiusKm: DEFAULT_RADIUS_KM, priceMin: null, priceMax: null }

/** How many filters differ from the defaults -- the badge on the «فیلترها» button. */
export function activeFilterCount(f: SearchFilters): number {
  return (f.radiusKm !== DEFAULT_RADIUS_KM ? 1 : 0) + (f.priceMin !== null || f.priceMax !== null ? 1 : 0)
}

/** Query params for /search: only what differs from the API's defaults is sent. */
export function filterQuery(f: SearchFilters): { radiusKm?: number; priceMin?: number; priceMax?: number } {
  return {
    radiusKm: f.radiusKm !== DEFAULT_RADIUS_KM ? f.radiusKm : undefined,
    priceMin: f.priceMin ?? undefined,
    priceMax: f.priceMax ?? undefined,
  }
}

/** «۲۰۰٬۰۰۰ تا ۱٬۵۰۰٬۰۰۰ تومان», «از ۲۰۰٬۰۰۰ تومان», «تا ۱٬۵۰۰٬۰۰۰ تومان». */
export function priceBandLabel(min: number | null, max: number | null): string | null {
  const fmt = (n: number) => n.toLocaleString('fa-IR')
  if (min !== null && max !== null) return `${fmt(min)} تا ${fmt(max)} تومان`
  if (min !== null) return `از ${fmt(min)} تومان`
  if (max !== null) return `تا ${fmt(max)} تومان`
  return null
}

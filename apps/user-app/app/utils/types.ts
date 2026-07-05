export interface SearchResult {
  id: string
  name: string
  slug: string
  city: string
  address: string
  ratingAvg: number
  ratingCount: number
  distanceKm: number
  minPrice: number | null
  coverPhoto: string | null
  isFeatured: boolean
}

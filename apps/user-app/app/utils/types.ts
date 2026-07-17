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
  hasActiveStory: boolean
}

/** Public story shape from GET /salons/:slug/stories (published, unexpired only). */
export interface SalonStoryItem {
  id: string
  url: string
  caption: string | null
  serviceId: string | null
  createdAt: string
  expiresAt: string
}

/** Public portfolio shape from GET /salons/:slug/portfolio (published only). */
export interface SalonPortfolioItem {
  id: string
  url: string
  caption: string | null
  serviceId: string | null
  sortOrder: number
}

export interface BlogCategory {
  id: number
  name: string
  slug: string
}

export interface BlogPostListItem {
  id: string
  title: string
  slug: string
  excerpt: string | null
  coverImageUrl: string | null
  categoryName: string | null
  categorySlug: string | null
  authorName: string | null
  publishedAt: string
}

export interface BlogListResponse {
  items: BlogPostListItem[]
  total: number
  page: number
  pageSize: number
}

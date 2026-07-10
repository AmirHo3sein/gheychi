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

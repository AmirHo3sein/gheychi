import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SearchQueryDto } from './dto/search.dto';

export interface SearchResult {
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
  isFeatured: boolean;
  hasActiveStory: boolean;
}

const FEATURED_CAP = 2;

@Injectable()
export class SearchService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async search(q: SearchQueryDto): Promise<SearchResult[]> {
    const radiusMeters = (q.radiusKm ?? 5) * 1000;
    const sortByRating = q.sort === 'rating';
    const secondarySort = sortByRating ? 's.rating_avg DESC, distance_km ASC' : 'distance_km ASC';

    const rows = await this.dataSource.query(
      `
      SELECT
        s.id, s.name, s.slug, s.city, s.address,
        s.rating_avg, s.rating_count,
        (s.is_featured AND (s.featured_until IS NULL OR s.featured_until > now())) AS is_featured,
        ST_Distance(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS distance_km,
        (SELECT MIN(ss.price) FROM salon_services ss
           WHERE ss.salon_id = s.id AND ss.is_active
             AND ($5::int IS NULL OR ss.category_id = $5)) AS min_price,
        (SELECT sp.url FROM salon_photos sp
           WHERE sp.salon_id = s.id ORDER BY sp.is_cover DESC, sp.sort_order ASC LIMIT 1) AS cover_photo,
        EXISTS (SELECT 1 FROM salon_stories st
           WHERE st.salon_id = s.id AND st.status = 'published' AND st.expires_at > now()) AS has_active_story
      FROM salons s
      WHERE s.status = 'approved'
        AND s.gender_target = $3
        AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
        AND ($5::int IS NULL OR EXISTS (
          SELECT 1 FROM salon_services ss2
          WHERE ss2.salon_id = s.id AND ss2.category_id = $5 AND ss2.is_active))
      ORDER BY is_featured DESC, ${secondarySort}
      LIMIT 50
      -- MVP cap, no pagination yet. Revisit if a single search radius
      -- can plausibly exceed 50 approved salons.
      `,
      [q.lng, q.lat, q.gender, radiusMeters, q.categoryId ?? null],
    );

    const mapped = rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      slug: r.slug as string,
      city: r.city as string,
      address: r.address as string,
      ratingAvg: Number(r.rating_avg),
      ratingCount: Number(r.rating_count),
      distanceKm: Number(r.distance_km),
      minPrice: r.min_price === null ? null : Number(r.min_price),
      coverPhoto: (r.cover_photo as string) ?? null,
      isFeatured: r.is_featured as boolean,
      hasActiveStory: r.has_active_story as boolean,
    }));

    // The query already orders featured salons first (each group internally sorted by
    // secondarySort); enforce the display cap here so no more than FEATURED_CAP results
    // ever carry the featured boost/badge. Salons past the cap must NOT simply keep their
    // spot in the featured block -- they have to fall back to wherever they'd rank among
    // the non-featured results, or the cap does nothing to bound how far an over-featured
    // catalog can distort results. Since both the kept-featured and non-featured slices are
    // already sorted by secondarySort, demoted overflow entries can be merged into the
    // non-featured tail with a simple sorted merge instead of a full re-sort.
    const compare = (a: SearchResult, b: SearchResult): number => {
      if (sortByRating && a.ratingAvg !== b.ratingAvg) return b.ratingAvg - a.ratingAvg;
      return a.distanceKm - b.distanceKm;
    };

    const featuredKept: SearchResult[] = [];
    const overflow: SearchResult[] = [];
    const nonFeatured: SearchResult[] = [];
    let featuredSeen = 0;
    for (const r of mapped) {
      if (!r.isFeatured) {
        nonFeatured.push(r);
        continue;
      }
      featuredSeen += 1;
      if (featuredSeen <= FEATURED_CAP) {
        featuredKept.push(r);
      } else {
        overflow.push({ ...r, isFeatured: false });
      }
    }

    const merged: SearchResult[] = [];
    let i = 0;
    let j = 0;
    while (i < overflow.length && j < nonFeatured.length) {
      merged.push(compare(overflow[i], nonFeatured[j]) <= 0 ? overflow[i++] : nonFeatured[j++]);
    }
    while (i < overflow.length) merged.push(overflow[i++]);
    while (j < nonFeatured.length) merged.push(nonFeatured[j++]);

    return [...featuredKept, ...merged];
  }
}

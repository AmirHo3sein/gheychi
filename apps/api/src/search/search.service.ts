import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AnalyticsService } from '../analytics/analytics.service';
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
  // Cheapest AFTER per-service discounts -- the price the customer would really pay,
  // so the card can never advertise more than the salon page and checkout charge.
  minPrice: number | null;
  coverPhoto: string | null;
  isFeatured: boolean;
  hasActiveStory: boolean;
  categories: Array<{ id: number; name: string; icon: string }>;
}

export interface SearchPage {
  items: SearchResult[];
  nextCursor: string | null;
  hasMore: boolean;
}

const FEATURED_CAP = 2;
const DEFAULT_PAGE_SIZE = 50;
// Hard ceiling on how many rows a single cursor walk will ever fetch from Postgres --
// pagination works by re-fetching `page * pageSize` rows and slicing (see search()
// below), so without a ceiling a client that just keeps requesting "more" could walk
// this all the way up to the full catalog. Once hit, hasMore is forced false.
const MAX_FETCH_ROWS = 1000;

interface SearchCursor {
  page: number;
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 1;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as SearchCursor;
    return Number.isInteger(parsed.page) && parsed.page >= 1 ? parsed.page : 1;
  } catch {
    // A malformed/tampered cursor just restarts pagination from page 1 rather than
    // erroring -- it's an opaque continuation token, not a client-facing contract.
    return 1;
  }
}

function encodeCursor(page: number): string {
  return Buffer.from(JSON.stringify({ page } satisfies SearchCursor)).toString('base64url');
}

@Injectable()
export class SearchService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    // Appended at the end, same convention as BookingsService/PaymentsService's own
    // constructors -- every existing positional `new SearchService(...)` call site
    // only needs an arg added at the tail, not threaded through the middle.
    private readonly analytics: AnalyticsService,
  ) {}

  async search(q: SearchQueryDto): Promise<SearchPage> {
    // 5km silently excluded any salon in the same city whose pin wasn't within easy walking
    // distance of the exact searched point -- a real salon 11-12km from a city's canonical
    // center (a completely normal distance within a metro like Tehran, which spans ~30km)
    // just vanished from results with no explanation. 15km comfortably covers a typical
    // city's built-up area without reaching into a neighboring city for most searches.
    const radiusMeters = (q.radiusKm ?? 15) * 1000;
    const sortByRating = q.sort === 'rating';
    const secondarySort = sortByRating ? 's.rating_avg DESC, distance_km ASC' : 'distance_km ASC';

    const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
    const page = decodeCursor(q.cursor);
    // The featured-boost reordering below runs in application code over the whole
    // fetched set (it must never bypass the SQL filters/sort, only re-rank within
    // them) -- so a page beyond the first can't be fetched with a SQL OFFSET alone
    // without risking a different featured-cap outcome than a single unpaginated
    // fetch would have produced. Instead each request re-fetches every row up to and
    // including this page (bounded by MAX_FETCH_ROWS) and re-derives the full
    // display order from scratch, then slices out just this page's window -- more
    // work per request than a true seek, but identical results to today's single-page
    // behavior on page 1, and correctness (never misplacing the featured cap) over
    // efficiency for what stays a modest, capped row count.
    const fetchLimit = Math.min(page * pageSize, MAX_FETCH_ROWS);

    const rows = await this.dataSource.query(
      `
      SELECT
        s.id, s.name, s.slug, s.city, s.address,
        s.rating_avg, s.rating_count,
        (s.is_featured AND (s.featured_until IS NULL OR s.featured_until > now())) AS is_featured,
        ST_Distance(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS distance_km,
        -- The card's "از X تومان" has to quote what the customer would actually be
        -- charged, so the minimum is taken over each service's DISCOUNTED price. Note
        -- MIN(discounted), not discount-applied-to-MIN(price): the cheapest service
        -- before a discount is often not the cheapest one after it.
        --
        -- The expression mirrors applyDiscount() (booking/discount.util.ts) exactly, so a
        -- card price can never disagree with checkout by a rounding unit: the ::numeric
        -- cast is load-bearing twice over -- it keeps price * pct / 100 out of integer
        -- division, and it picks round(numeric) (half away from zero, matching JS
        -- Math.round for positive prices) over round(double precision), which
        -- banker's-rounds. A NULL discount_percent means "no discount" and the CHECK
        -- constraint pins the rest to 1..100, so the 0 case is exactly a no-op here.
        (SELECT MIN(round(ss.price::numeric * (100 - COALESCE(ss.discount_percent, 0)) / 100))
           FROM salon_services ss
           WHERE ss.salon_id = s.id AND ss.is_active
             AND ($5::int IS NULL OR ss.category_id = $5)) AS min_price,
        (SELECT sp.url FROM salon_photos sp
           WHERE sp.salon_id = s.id ORDER BY sp.is_cover DESC, sp.sort_order ASC LIMIT 1) AS cover_photo,
        EXISTS (SELECT 1 FROM salon_stories st
           WHERE st.salon_id = s.id AND st.status = 'published' AND st.expires_at > now()) AS has_active_story,
        -- The card's category badges -- deliberate owner-set tags (salon_categories),
        -- not derived from whatever services happen to be listed. COALESCE keeps an
        -- untagged salon's categories as [] rather than a JSON null the frontend would
        -- have to guard against.
        COALESCE((
          SELECT json_agg(json_build_object('id', sc.id, 'name', sc.name, 'icon', sc.icon) ORDER BY sc.name)
          FROM salon_categories salc JOIN service_categories sc ON sc.id = salc.category_id
          WHERE salc.salon_id = s.id
        ), '[]'::json) AS categories
      FROM salons s
      WHERE s.status = 'approved'
        AND s.gender_target = $3
        AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
        AND ($5::int IS NULL OR EXISTS (
          SELECT 1 FROM salon_categories sc2
          WHERE sc2.salon_id = s.id AND sc2.category_id = $5))
      ORDER BY is_featured DESC, ${secondarySort}
      LIMIT $6
      `,
      [q.lng, q.lat, q.gender, radiusMeters, q.categoryId ?? null, fetchLimit],
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
      categories: r.categories as Array<{ id: number; name: string; icon: string }>,
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

    const allFetched = [...featuredKept, ...merged];
    const start = (page - 1) * pageSize;
    const items = allFetched.slice(start, start + pageSize);

    // rows.length < fetchLimit means Postgres genuinely ran out of matching salons --
    // there is nothing beyond what was fetched, regardless of how this page's slice
    // landed. Otherwise (we got exactly fetchLimit rows back) there MIGHT be more
    // beyond it, unless the abuse ceiling is what stopped us from asking for more.
    const reachedEndOfData = rows.length < fetchLimit;
    const moreWithinFetched = start + pageSize < allFetched.length;
    const hasMore = moreWithinFetched || (!reachedEndOfData && fetchLimit < MAX_FETCH_ROWS);

    // Best-effort and never awaited, same rationale as BookingsService's own
    // booking_started call -- an analytics outage must add zero latency/failure risk
    // to this public, unauthenticated, high-traffic endpoint. Deliberately carries no
    // raw query text (this endpoint has no free-text field to begin with) and no
    // lat/lng (precise enough to pin down a searcher's real-world location) -- only
    // the structured filters the client actually chose (gender/categoryId/sort/radius)
    // plus how many results came back, which is exactly the shape useful for later
    // "are searches returning anything" analysis without carrying anything that could
    // identify the searcher.
    void this.analytics
      .track('search_performed', {
        gender: q.gender,
        categoryId: q.categoryId ?? null,
        sort: q.sort ?? 'distance',
        radiusKm: q.radiusKm ?? 15,
        page,
        resultCount: items.length,
        hasMore,
      })
      .catch(() => {});

    return { items, nextCursor: hasMore ? encodeCursor(page + 1) : null, hasMore };
  }
}

import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search.dto';

function row(i: number) {
  return {
    id: `salon-${i}`,
    name: `Salon ${i}`,
    slug: `salon-${i}`,
    city: 'Tehran',
    address: 'Addr',
    rating_avg: 0,
    rating_count: 0,
    is_featured: false,
    distance_km: i,
    min_price: null,
    cover_photo: null,
    has_active_story: false,
    categories: [],
  };
}

const BASE_QUERY: SearchQueryDto = { lat: 35.7, lng: 51.4, gender: 'women' };

describe('SearchService', () => {
  let query: jest.Mock;
  let service: SearchService;

  beforeEach(() => {
    query = jest.fn();
    service = new SearchService({ query } as never);
  });

  it('requests the default page size (50) as the SQL LIMIT when no cursor is given', async () => {
    query.mockResolvedValue([]);

    await service.search(BASE_QUERY);

    const [, params] = query.mock.calls[0];
    expect(params[params.length - 1]).toBe(50);
  });

  it('returns hasMore=false and nextCursor=null when fewer rows come back than requested', async () => {
    query.mockResolvedValue([row(0), row(1)]);

    const result = await service.search(BASE_QUERY);

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('sets hasMore=true and a non-null nextCursor when a full page comes back under the fetch ceiling', async () => {
    query.mockResolvedValue(Array.from({ length: 50 }, (_, i) => row(i)));

    const result = await service.search(BASE_QUERY);

    expect(result.items).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it('a cursor from a first response round-trips to fetch page*pageSize rows and slices out the second page', async () => {
    query.mockResolvedValueOnce(Array.from({ length: 2 }, (_, i) => row(i)));
    const first = await service.search({ ...BASE_QUERY, pageSize: 2 });
    expect(first.nextCursor).toEqual(expect.any(String));

    query.mockResolvedValueOnce(Array.from({ length: 4 }, (_, i) => row(i)));
    const second = await service.search({ ...BASE_QUERY, pageSize: 2, cursor: first.nextCursor! });

    const [, params] = query.mock.calls[1];
    expect(params[params.length - 1]).toBe(4); // page 2 * pageSize 2
    expect(second.items.map((r) => r.id)).toEqual(['salon-2', 'salon-3']);
  });

  it('treats a malformed/tampered cursor as page 1 instead of erroring', async () => {
    query.mockResolvedValue([row(0)]);

    const result = await service.search({ ...BASE_QUERY, cursor: 'not-a-real-cursor', pageSize: 10 });

    const [, params] = query.mock.calls[0];
    expect(params[params.length - 1]).toBe(10); // page 1 * pageSize 10, not further along
    expect(result.items).toHaveLength(1);
  });

  it('stops advancing once the fetch ceiling is reached, even if the DB has more rows', async () => {
    // page 21 * pageSize 50 = 1050, clamped to the 1000-row ceiling; a full 1000-row
    // response is ambiguous (could be exactly 1000 or more) but the ceiling means
    // there is no further page to walk to.
    query.mockResolvedValue(Array.from({ length: 1000 }, (_, i) => row(i)));

    const result = await service.search({
      ...BASE_QUERY,
      pageSize: 50,
      cursor: Buffer.from(JSON.stringify({ page: 21 })).toString('base64url'),
    });

    const [, params] = query.mock.calls[0];
    expect(params[params.length - 1]).toBe(1000);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});

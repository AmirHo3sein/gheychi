import { Repository } from 'typeorm';
import { CATEGORIES_CACHE_KEY, CATEGORIES_CACHE_TTL_SEC } from './categories-cache.util';
import { CatalogController } from './catalog.controller';
import { ServiceCategory } from './service-category.entity';

const CATEGORIES = [{ id: 1, name: 'کوتاهی مو', icon: 'scissors' }];

describe('CatalogController', () => {
  let controller: CatalogController;
  let find: jest.Mock;
  let redis: { get: jest.Mock; set: jest.Mock };

  beforeEach(() => {
    find = jest.fn().mockResolvedValue(CATEGORIES);
    redis = { get: jest.fn(), set: jest.fn().mockResolvedValue('OK') };
    controller = new CatalogController({ find } as unknown as Repository<ServiceCategory>, redis as never);
  });

  it('reads through to Postgres on a cache miss and populates the cache with a TTL', async () => {
    redis.get.mockResolvedValue(null);

    const result = await controller.list();

    expect(result).toEqual(CATEGORIES);
    expect(find).toHaveBeenCalledWith({ order: { id: 'ASC' } });
    expect(redis.set).toHaveBeenCalledWith(CATEGORIES_CACHE_KEY, JSON.stringify(CATEGORIES), 'EX', CATEGORIES_CACHE_TTL_SEC);
  });

  it('serves a cache hit without ever touching Postgres', async () => {
    redis.get.mockResolvedValue(JSON.stringify(CATEGORIES));

    const result = await controller.list();

    expect(result).toEqual(CATEGORIES);
    expect(find).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

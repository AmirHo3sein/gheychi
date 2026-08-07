import { Repository } from 'typeorm';
import { CitiesService } from './cities.service';
import { City } from './city.entity';

const TEHRAN = { id: 1, name: 'تهران', slug: 'tehran', province: 'تهران', lat: 35.6892, lng: 51.389, sortOrder: 0, createdAt: new Date() };
const MASHHAD = { id: 2, name: 'مشهد', slug: 'mashhad', province: 'خراسان رضوی', lat: 36.2605, lng: 59.6168, sortOrder: 1, createdAt: new Date() };

describe('CitiesService', () => {
  describe('list', () => {
    it('orders by sortOrder ascending', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const service = new CitiesService({ find } as unknown as Repository<City>);

      await service.list();

      expect(find).toHaveBeenCalledWith({ order: { sortOrder: 'ASC' } });
    });

    it('caches the result in-process: a second call never hits the repository again', async () => {
      const find = jest.fn().mockResolvedValue([TEHRAN, MASHHAD]);
      const service = new CitiesService({ find } as unknown as Repository<City>);

      const first = await service.list();
      const second = await service.list();

      expect(find).toHaveBeenCalledTimes(1);
      expect(first).toEqual([TEHRAN, MASHHAD]);
      expect(second).toBe(first); // same cached reference, not just deep-equal
    });
  });

  describe('findIdByName', () => {
    it('resolves the id of a canonical city by exact name match', async () => {
      const find = jest.fn().mockResolvedValue([TEHRAN, MASHHAD]);
      const service = new CitiesService({ find } as unknown as Repository<City>);

      await expect(service.findIdByName('تهران')).resolves.toBe(1);
    });

    it('resolves to null (not an error) for a name with no canonical match', async () => {
      const find = jest.fn().mockResolvedValue([TEHRAN, MASHHAD]);
      const service = new CitiesService({ find } as unknown as Repository<City>);

      await expect(service.findIdByName('یک روستای کوچک')).resolves.toBeNull();
    });

    it('shares the same cache as list() -- never issues its own separate query', async () => {
      const find = jest.fn().mockResolvedValue([TEHRAN, MASHHAD]);
      const service = new CitiesService({ find } as unknown as Repository<City>);

      await service.list();
      await service.findIdByName('مشهد');
      await service.findIdByName('تهران');

      expect(find).toHaveBeenCalledTimes(1);
    });
  });
});

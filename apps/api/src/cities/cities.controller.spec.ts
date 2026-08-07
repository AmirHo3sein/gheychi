import { CitiesController } from './cities.controller';
import { CitiesService } from './cities.service';
import { City } from './city.entity';

describe('CitiesController', () => {
  it('returns the service list mapped to the public shape, in the same (sortOrder) order', async () => {
    const rows: City[] = [
      { id: 1, name: 'تهران', slug: 'tehran', province: 'تهران', lat: 35.6892, lng: 51.389, sortOrder: 0, createdAt: new Date() },
      { id: 2, name: 'مشهد', slug: 'mashhad', province: 'خراسان رضوی', lat: 36.2605, lng: 59.6168, sortOrder: 1, createdAt: new Date() },
    ];
    const cities = { list: jest.fn().mockResolvedValue(rows) };
    const controller = new CitiesController(cities as unknown as CitiesService);

    const result = await controller.list();

    expect(cities.list).toHaveBeenCalled();
    expect(result).toEqual([
      { id: 1, name: 'تهران', slug: 'tehran', province: 'تهران', lat: 35.6892, lng: 51.389 },
      { id: 2, name: 'مشهد', slug: 'mashhad', province: 'خراسان رضوی', lat: 36.2605, lng: 59.6168 },
    ]);
  });

  it('never leaks internal-only fields (sortOrder, createdAt) into the public response', async () => {
    const rows: City[] = [
      { id: 1, name: 'تهران', slug: 'tehran', province: 'تهران', lat: 35.6892, lng: 51.389, sortOrder: 0, createdAt: new Date() },
    ];
    const cities = { list: jest.fn().mockResolvedValue(rows) };
    const controller = new CitiesController(cities as unknown as CitiesService);

    const [city] = await controller.list();

    expect(city).not.toHaveProperty('sortOrder');
    expect(city).not.toHaveProperty('createdAt');
  });
});

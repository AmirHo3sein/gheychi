import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CitiesService } from './cities.service';

// Kept as the same {name, lat, lng} shape the old static-array response had, plus id/slug/
// province as purely additive fields (existing consumers that only read name/lat/lng are
// unaffected) -- see docs/phase2-plan.md item 2 for why backward compatibility here means
// "the DB table replaces the static array with the same response shape/order," not "a new
// contract."
export interface PublicCity {
  id: number;
  name: string;
  slug: string;
  province: string;
  lat: number;
  lng: number;
}

@Controller('cities')
@Public()
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Get()
  async list(): Promise<PublicCity[]> {
    const rows = await this.cities.list();
    return rows.map(({ id, name, slug, province, lat, lng }) => ({ id, name, slug, province, lat, lng }));
  }
}

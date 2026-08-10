import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { City } from './city.entity';

@Injectable()
export class CitiesService {
  // Cities are seeded once via migration (1754300000000-cities-table.ts) with no admin
  // mutation endpoint anywhere in the app -- there is no write path to invalidate against,
  // so a plain in-process cache (populated once, kept for the process's lifetime) is
  // correct here, not just an optimization with an edge case to worry about. GET /cities
  // is public and parameter-less, hit on nearly every browse/search page load.
  private cached: City[] | null = null;

  constructor(@InjectRepository(City) private readonly repo: Repository<City>) {}

  async list(): Promise<City[]> {
    this.cached ??= await this.repo.find({ order: { sortOrder: 'ASC' } });
    return this.cached;
  }

  /**
   * Best-effort resolution of a free-text city name to its canonical row id, used by
   * SalonsService to populate salons.city_id on create/update (and, since the API-level
   * validation this backs, to decide whether a submitted city is "canonical" at all).
   * Match is exact on the trimmed name -- leading/trailing whitespace only. Persian has
   * no case-folding question the way Latin scripts do, and full transliteration/glyph
   * normalization (e.g. ك/ک, ي/ی) is deliberately out of scope: guessing at those would
   * risk silently linking to the wrong city. A name that still doesn't match any
   * canonical city (a small town not in the curated list, or a genuinely different name)
   * resolves to null, which is a normal, expected outcome, not an error: salons.city
   * stays exactly the free text the owner typed either way. Resolved against the same
   * cached list as list() rather than a separate query -- one cache, two read shapes.
   */
  async findIdByName(name: string): Promise<number | null> {
    const normalized = name.trim();
    const cities = await this.list();
    return cities.find((city) => city.name === normalized)?.id ?? null;
  }
}

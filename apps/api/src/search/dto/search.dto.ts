import { Type } from 'class-transformer';
import { IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { MAX_PRICE_TOMAN } from '../../common/money-limits';

export class SearchQueryDto {
  // Substring match against the salon's own name (ILIKE, same simple pattern as every
  // other free-text filter in this codebase -- admin-salons.controller.ts's own `name`
  // filter, content/blog search, review search -- no tsvector/trigram index anywhere in
  // this codebase to match against, so this doesn't introduce one either).
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @IsIn(['women', 'men'])
  gender: 'women' | 'men';

  @IsOptional()
  @Type(() => Number)
  @Min(0.5)
  @Max(50)
  radiusKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  // Matches a salon that has AT LEAST ONE active service (after its own discount) priced
  // within [priceMin, priceMax] -- not "the salon's cheapest service falls in this range",
  // which would silently exclude a salon whose affordable service isn't its very cheapest
  // one. Same discounted-price expression as minPrice below, so a result here is never
  // inconsistent with what the card/checkout would actually charge.
  // @IsInt (not just @Min): `1.5`, `Infinity` or `NaN` pass a bare @Min(0)/@Type(Number)
  // and are then bound as ::bigint, which Postgres rejects -- a 500 on a public route.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_TOMAN)
  priceMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_TOMAN)
  priceMax?: number;

  @IsOptional()
  @IsIn(['distance', 'rating'])
  sort?: 'distance' | 'rating';

  // Opaque, server-issued continuation token (SearchService.encodeCursor) -- never
  // constructed by the client, only round-tripped from a prior response's nextCursor.
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

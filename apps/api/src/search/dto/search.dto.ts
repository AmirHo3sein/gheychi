import { Type } from 'class-transformer';
import { IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, Min } from 'class-validator';

export class SearchQueryDto {
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

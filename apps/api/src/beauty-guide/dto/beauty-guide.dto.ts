import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString,
  Length, Matches, Max, Min,
} from 'class-validator';
import { BEAUTY_DOMAINS, BeautyDomain } from '../beauty-concept.entity';

const CONCEPT_KEY = /^[a-z][a-z0-9_]*$/;

/**
 * The customer's corrections. Concept edits are by key (the controlled vocabulary), and
 * attribute edits are validated against the closed enums in the service -- a key set to
 * null clears it. Only these targeted corrections exist; there is no free-form editing of
 * AI text.
 */
export class UpdateBeautyGuideDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Matches(CONCEPT_KEY, { each: true })
  removeConceptKeys?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Matches(CONCEPT_KEY, { each: true })
  restoreConceptKeys?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Matches(CONCEPT_KEY, { each: true })
  addConceptKeys?: string[];

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string | null>;
}

export class BeautyGuideMatchesQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(50)
  radiusKm?: number;
}

export class CreateBeautyConceptDto {
  @IsString()
  @Length(2, 60)
  @Matches(CONCEPT_KEY)
  key: string;

  @IsIn(BEAUTY_DOMAINS)
  domain: BeautyDomain;

  @IsString()
  @Length(1, 80)
  nameFa: string;

  @IsString()
  @Length(1, 80)
  nameEn: string;

  @IsOptional()
  @IsInt()
  categoryId?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  @Length(0, 500)
  maintenanceFa?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** `key` is immutable (stored guides reference concepts by id, but the AI contract speaks keys). */
export class UpdateBeautyConceptDto {
  @IsOptional()
  @IsIn(BEAUTY_DOMAINS)
  domain?: BeautyDomain;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  nameFa?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  nameEn?: string;

  @IsOptional()
  @IsInt()
  categoryId?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  @Length(0, 500)
  maintenanceFa?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

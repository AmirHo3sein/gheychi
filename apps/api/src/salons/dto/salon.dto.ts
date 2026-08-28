import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize, ArrayUnique, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Length, Matches, Max,
  MaxLength, Min,
} from 'class-validator';

// Sending '' clears the field (stored as NULL); @IsOptional skips the remaining
// validators for null, so an empty string never has to pass the length/format checks.
const emptyToNull = ({ value }: { value: unknown }) => (value === '' ? null : value);

export class CreateSalonDto {
  @IsString()
  @Length(2, 150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(['women', 'men'])
  genderTarget: 'women' | 'men';

  @IsString()
  @Length(5, 500)
  address: string;

  @IsString()
  @Length(2, 80)
  city: string;

  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;

  // Required, not optional: a salon a customer can never find under any category
  // filter is a salon that effectively doesn't exist for search. Deliberate tags,
  // independent of which services the salon happens to list -- see
  // salon-category.entity.ts's own doc comment.
  @Type(() => Number)
  @IsInt({ each: true })
  @ArrayMinSize(1)
  @ArrayUnique()
  categoryIds: number[];
}

export class UpdateSalonDto {
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(['women', 'men']) genderTarget?: 'women' | 'men';
  @IsOptional() @IsString() @Length(5, 500) address?: string;
  @IsOptional() @IsString() @Length(2, 80) city?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) capacity?: number;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(120) tagline?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000) about?: string | null;
  // The strict handle charset is the safety boundary that keeps the user-app's
  // `https://instagram.com/<handle>` links injection-free.
  @IsOptional() @Transform(emptyToNull) @Matches(/^[A-Za-z0-9._]{1,30}$/) instagramHandle?: string | null;
  // The ONE booking setting an owner controls. The two timeout overrides that sit
  // beside it on the salons table are deliberately absent from this DTO: updateMine()
  // applies whatever survives validation via a blanket Object.assign, so adding them
  // here would hand providers the power to set their own deadlines. They are writable
  // only through PATCH /admin/salons/:id/booking-settings.
  @IsOptional() @IsIn(['automatic', 'manual_approval']) bookingConfirmationMode?: 'automatic' | 'manual_approval';
  // Undefined leaves the salon's tags unchanged; an explicit array (must be
  // non-empty, same reasoning as CreateSalonDto's) replaces them wholesale.
  @IsOptional()
  @Type(() => Number)
  @IsInt({ each: true })
  @ArrayMinSize(1)
  @ArrayUnique()
  categoryIds?: number[];
}

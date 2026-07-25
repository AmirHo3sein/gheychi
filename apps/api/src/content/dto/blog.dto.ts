import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

// URL-safe slug: unicode letters/digits in single-hyphen-separated runs — allows
// Persian SEO slugs (they percent-encode cleanly in URLs). Length caps match the
// migration DDL (blog_posts.slug varchar(220), blog_categories.slug varchar(80)).
export const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

export class CreateBlogPostDto {
  @IsString()
  @Length(1, 200)
  title: string;

  // Optional explicit slug — same escape hatch as CreateBlogCategoryDto.slug: omitted,
  // the server derives one from the title (post-<hex> for Persian titles). Accepting it
  // on create keeps the operation atomic — a 409 slug conflict creates nothing, instead
  // of the old create-then-PATCH flow silently keeping the auto slug. Cap matches
  // blog_posts.slug varchar(220).
  @IsOptional()
  @IsString()
  @Matches(SLUG_PATTERN)
  @MaxLength(220)
  slug?: string;

  @IsString()
  @MinLength(1)
  bodyMarkdown: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  authorName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  metaDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ogTitle?: string | null;
}

export class UpdateBlogPostDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(SLUG_PATTERN)
  @MaxLength(220)
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  bodyMarkdown?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  authorName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  metaDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ogTitle?: string | null;
}

export class AdminBlogPostQueryDto {
  @IsOptional()
  @IsIn(['draft', 'published', 'all'])
  status?: 'draft' | 'published' | 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  // Free-text title search, ILIKE-matched (admin-salons.controller.ts's `name` filter
  // precedent) -- not length-capped beyond the title column itself since this is a
  // search term, not stored data.
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CreateBlogCategoryDto {
  @IsString()
  @Length(1, 60)
  name: string;

  // Optional explicit slug — makeSlug(name, 'category')'s non-latin fallback produces
  // a random category-<hex> slug for Persian names, so admins who care about the public
  // /blog?category= URL pass one here (the deliberate escape hatch). Cap matches
  // blog_categories.slug varchar(80).
  @IsOptional()
  @IsString()
  @Matches(SLUG_PATTERN)
  @MaxLength(80)
  slug?: string;
}

export class UpdateBlogCategoryDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(SLUG_PATTERN)
  @MaxLength(80)
  slug?: string;
}

export class PublicBlogPostsQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

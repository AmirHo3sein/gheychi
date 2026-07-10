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

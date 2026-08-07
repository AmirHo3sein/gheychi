import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import { isForeignKeyViolation, isUniqueViolation } from '../common/postgres-error-codes';
import { makeSlug } from '../common/slug.util';
import { assertTrustedImageMimeType, EXTENSION_BY_IMAGE_MIME_TYPE } from '../common/trusted-image-upload';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
import { BlogCategory } from './blog-category.entity';
import { BlogPost, BlogPostStatus } from './blog-post.entity';
import {
  AdminBlogPostQueryDto,
  CreateBlogCategoryDto,
  CreateBlogPostDto,
  UpdateBlogCategoryDto,
  UpdateBlogPostDto,
} from './dto/blog.dto';

export interface AdminBlogPostListItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  status: BlogPostStatus;
  categoryId: number | null;
  categoryName: string | null;
  authorName: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicBlogPostListItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  authorName: string | null;
  publishedAt: Date | null;
}

// Exact message from the Plan 8 spec (§3.2) — surfaced as a toast by the admin panel.
const SLUG_CONFLICT = 'این نامک قبلاً استفاده شده است';
// name and slug are both UNIQUE on blog_categories; one 23505 message covers both.
const CATEGORY_CONFLICT = 'دسته‌بندی با این نام یا نامک از قبل وجود دارد';
// Exact message from the Plan 8 spec (§3.3) for the FK-restricted delete.
const CATEGORY_IN_USE = 'این دسته‌بندی دارای مطلب است و قابل حذف نیست';
// Carry-forward from Task 3's review: createPost/updatePost translate a nonexistent
// categoryId (23503) into a 400 instead of letting it fall through as a raw 500.
const CATEGORY_NOT_FOUND = 'دسته‌بندی انتخاب‌شده وجود ندارد';

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    @InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>,
    @InjectRepository(BlogCategory) private readonly categories: Repository<BlogCategory>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async createPost(dto: CreateBlogPostDto): Promise<BlogPost> {
    try {
      return await this.posts.save(
        this.posts.create({
          title: dto.title,
          // An explicit dto.slug wins (atomic create-with-slug — same escape hatch as
          // createCategory); otherwise auto slug from the title (spec §3.2), editable via
          // updatePost. The 'post' fallbackPrefix (Task 2) gives Persian titles a
          // post-<hex> slug; makeSlug's random suffix makes collisions unlikely, but the
          // DB UNIQUE stays the source of truth — 23505 translated below.
          slug: dto.slug ?? makeSlug(dto.title, 'post'),
          excerpt: dto.excerpt || null,
          bodyMarkdown: dto.bodyMarkdown,
          categoryId: dto.categoryId ?? null,
          authorName: dto.authorName || null,
          metaDescription: dto.metaDescription || null,
          ogTitle: dto.ogTitle || null,
          status: 'draft',
          // Explicit null so the create response serializes publishedAt as null — the DB
          // default would leave the property undefined on the returned entity (the e2e
          // suite pins publishedAt: null on the create response).
          publishedAt: null,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(SLUG_CONFLICT);
      if (isForeignKeyViolation(err)) throw new BadRequestException(CATEGORY_NOT_FOUND);
      throw err;
    }
  }

  async updatePost(id: string, dto: UpdateBlogPostDto): Promise<BlogPost> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');

    // NOT NULL columns only move to a new string; nullable content/SEO fields treat an
    // explicit null (or '') as "clear" and undefined as "keep" — @IsOptional() lets null
    // through the DTO by design.
    if (typeof dto.title === 'string') post.title = dto.title;
    if (typeof dto.slug === 'string') post.slug = dto.slug;
    if (typeof dto.bodyMarkdown === 'string') post.bodyMarkdown = dto.bodyMarkdown;
    if (dto.excerpt !== undefined) post.excerpt = dto.excerpt || null;
    if (dto.categoryId !== undefined) post.categoryId = dto.categoryId;
    if (dto.authorName !== undefined) post.authorName = dto.authorName || null;
    if (dto.metaDescription !== undefined) post.metaDescription = dto.metaDescription || null;
    if (dto.ogTitle !== undefined) post.ogTitle = dto.ogTitle || null;

    try {
      return await this.posts.save(post);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(SLUG_CONFLICT);
      if (isForeignKeyViolation(err)) throw new BadRequestException(CATEGORY_NOT_FOUND);
      throw err;
    }
  }

  async getPostForAdmin(id: string): Promise<BlogPost & { coverImageUrl: string | null }> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    return { ...post, coverImageUrl: post.coverImageKey ? this.storage.publicUrl(post.coverImageKey) : null };
  }

  async listPostsForAdmin(query: AdminBlogPostQueryDto): Promise<{
    items: AdminBlogPostListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    // Admins manage everything, so status defaults to 'all' here (spec §3.3) — unlike
    // the public queries (Plan 8 Task 6), which are hard-scoped to 'published'.
    const status = query.status ?? 'all';
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // categoryName via a raw entity-class join — the ReportsService.listForAdmin precedent
    // (single query, no relation decorators anywhere in this repo) rather than the
    // AuditService second-lookup style: the category name is a natural SQL join on exactly
    // the page being returned; a second lookup would add a round-trip plus in-memory
    // stitching for no gain here.
    const qb = this.posts
      .createQueryBuilder('post')
      .leftJoin(BlogCategory, 'category', 'category.id = post.categoryId')
      .select('post.id', 'id')
      .addSelect('post.title', 'title')
      .addSelect('post.slug', 'slug')
      .addSelect('post.excerpt', 'excerpt')
      .addSelect('post.status', 'status')
      .addSelect('post.categoryId', 'categoryId')
      .addSelect('category.name', 'categoryName')
      .addSelect('post.authorName', 'authorName')
      .addSelect('post.publishedAt', 'publishedAt')
      .addSelect('post.createdAt', 'createdAt')
      .addSelect('post.updatedAt', 'updatedAt')
      .orderBy('post.createdAt', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize);

    if (status !== 'all') qb.andWhere('post.status = :status', { status });
    if (query.categoryId !== undefined) qb.andWhere('post.categoryId = :categoryId', { categoryId: query.categoryId });
    if (query.title) qb.andWhere('post.title ILIKE :title', { title: `%${query.title}%` });

    const countWhere: FindOptionsWhere<BlogPost> = {};
    if (status !== 'all') countWhere.status = status;
    if (query.categoryId !== undefined) countWhere.categoryId = query.categoryId;
    if (query.title) countWhere.title = ILike(`%${query.title}%`);

    const [items, total] = await Promise.all([
      qb.getRawMany<AdminBlogPostListItem>(),
      this.posts.count({ where: countWhere }),
    ]);
    return { items, total, page, pageSize };
  }

  async publishPost(id: string): Promise<BlogPost> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    // Conditional update WHERE status='draft' — the same lost-race guard as
    // SalonsService.resubmitMine() / ReportsService.resolve(): a concurrent publish
    // affects 0 rows here and the loser gets a clear 409 instead of double-stamping.
    // published_at is stamped only on FIRST publish; a republish (after unpublish)
    // keeps the original date so public ordering and SEO dates stay stable.
    // COALESCE decides at write time, so the original date survives any interleaving
    // (no stale-read window between the findOneBy above and this update).
    const result = await this.posts
      .createQueryBuilder()
      .update()
      .set({ status: 'published', publishedAt: () => 'COALESCE(published_at, now())' })
      .where('id = :id AND status = :status', { id, status: 'draft' })
      .execute();
    if (!result.affected) {
      throw new ConflictException('این مطلب قبلاً منتشر شده است');
    }
    return (await this.posts.findOneBy({ id }))!;
  }

  async unpublishPost(id: string): Promise<BlogPost> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    // Conditional WHERE status='published'; published_at is deliberately untouched —
    // publishPost()'s republish path relies on it surviving an unpublish.
    const result = await this.posts.update({ id, status: 'published' }, { status: 'draft' });
    if (!result.affected) {
      throw new ConflictException('این مطلب در حال حاضر منتشر نیست');
    }
    return (await this.posts.findOneBy({ id }))!;
  }

  async setCover(id: string, file: Express.Multer.File): Promise<BlogPost & { coverImageUrl: string }> {
    // file.mimetype is the client-declared Content-Type header -- independent of the
    // controller's magic-number content validator -- and must be checked separately
    // before it's trusted for the storage Content-Type below (S3StorageProvider persists
    // it verbatim; see trusted-image-upload.ts for the full reasoning).
    assertTrustedImageMimeType(file.mimetype);
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    // Deliberately NOT using file.originalname in the key -- it's client-controlled and
    // could contain path-traversal sequences. file.mimetype is now verified-trusted
    // (above), so deriving the extension from it keeps the key fully server-controlled
    // (same reasoning as salon photo uploads).
    const extension = EXTENSION_BY_IMAGE_MIME_TYPE[file.mimetype] ?? 'bin';
    const key = `blog/${id}/${randomUUID()}.${extension}`;
    // If the save below fails after this upload succeeds, the fresh object is orphaned in
    // storage with no row pointing at it -- accepted (same harmless-orphan class as the
    // best-effort deletes; no cleanup pass exists by MVP scope cut).
    await this.storage.upload(file.buffer, key, file.mimetype);
    const oldKey = post.coverImageKey;
    post.coverImageKey = key;
    const saved = await this.posts.save(post);
    // Best-effort replace-cleanup AFTER the save: the DB row is the source of truth for
    // the cover; an orphaned object after a failed delete is a cleanup gap, not a
    // user-visible bug (same class of tradeoff as salon photo deletes) -- so the failure
    // is logged for observability but never fails the request.
    if (oldKey) {
      await this.storage.delete(oldKey).catch((err) => {
        this.logger.error(
          `Failed to delete storage object ${oldKey} for blog post ${id} (replaced by ${key}) -- object may be orphaned`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    }
    return { ...saved, coverImageUrl: this.storage.publicUrl(key) };
  }

  async clearCover(id: string): Promise<void> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    const oldKey = post.coverImageKey;
    if (!oldKey) return; // idempotent: nothing to clear
    post.coverImageKey = null;
    await this.posts.save(post);
    // Best-effort: same logged-but-swallowed cleanup tradeoff as setCover() above.
    await this.storage.delete(oldKey).catch((err) => {
      this.logger.error(
        `Failed to delete storage object ${oldKey} for blog post ${id} -- object may be orphaned`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  async deletePost(id: string): Promise<void> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    // Hard delete for any status (spec §3.3) — unpublish is the soft path.
    await this.posts.delete({ id });
    // Best-effort object cleanup after the row delete: the DB row is the source of
    // truth for what's public; an orphaned object after a storage failure is a
    // cleanup gap, not a user-visible bug (same tradeoff as
    // SalonPhotosController.remove()) -- so the failure is logged for observability
    // but never fails the request.
    if (post.coverImageKey) {
      await this.storage.delete(post.coverImageKey).catch((err) => {
        this.logger.error(
          `Failed to delete storage object ${post.coverImageKey} for deleted blog post ${id} -- object may be orphaned`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    }
  }

  async createCategory(dto: CreateBlogCategoryDto): Promise<BlogCategory> {
    try {
      // 'category' fallbackPrefix: a Persian name with no explicit dto.slug gets a
      // category-<hex> slug rather than makeSlug's salon-flavored default; the
      // optional dto.slug stays the escape hatch for readable Persian slugs.
      return await this.categories.save(
        this.categories.create({ name: dto.name, slug: dto.slug ?? makeSlug(dto.name, 'category') }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(CATEGORY_CONFLICT);
      throw err;
    }
  }

  async updateCategory(id: number, dto: UpdateBlogCategoryDto): Promise<BlogCategory> {
    const category = await this.categories.findOneBy({ id });
    if (!category) throw new NotFoundException('Category not found');
    if (typeof dto.name === 'string') category.name = dto.name;
    // Slug regenerates from the (possibly new) name unless the caller pinned one.
    if (typeof dto.slug === 'string') category.slug = dto.slug;
    else if (typeof dto.name === 'string') category.slug = makeSlug(dto.name, 'category');
    try {
      return await this.categories.save(category);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(CATEGORY_CONFLICT);
      throw err;
    }
  }

  async deleteCategory(id: number): Promise<void> {
    let result;
    try {
      result = await this.categories.delete({ id });
    } catch (err) {
      // No pre-check by design: blog_posts.category_id REFERENCES blog_categories(id)
      // (NO ACTION) makes Postgres the source of truth for "in use" — the same idiom
      // as AdminCategoriesController.remove().
      if (isForeignKeyViolation(err)) {
        throw new ConflictException(CATEGORY_IN_USE);
      }
      throw err;
    }
    if (!result.affected) throw new NotFoundException();
  }

  listCategories(): Promise<BlogCategory[]> {
    return this.categories.find({ order: { name: 'ASC' } });
  }

  async listPublishedPosts(query: {
    category?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: PublicBlogPostListItem[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20; // DTO caps pageSize at 100

    // Same where-object idiom as AuditService.listForAdmin.
    const where: Record<string, unknown> = { status: 'published' };
    if (query.category) {
      const category = await this.categories.findOneBy({ slug: query.category });
      // An unknown category slug can never match a post -- short-circuit instead of
      // issuing a query guaranteed to return nothing.
      if (!category) return { items: [], total: 0, page, pageSize };
      where.categoryId = category.id;
    }

    const [posts, total] = await this.posts.findAndCount({
      where,
      order: { publishedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Second IN lookup instead of a QB join: entities carry no relation decorators
    // (repo convention -- same as AuditService's actor lookup).
    const categoryIds = [...new Set(posts.map((p) => p.categoryId).filter((id): id is number => id !== null))];
    const categoriesById = new Map(
      (categoryIds.length ? await this.categories.find({ where: { id: In(categoryIds) } }) : []).map((c) => [
        c.id,
        c,
      ]),
    );

    const items = posts.map((post) => ({
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      // Same URL the storage provider returned at upload time (publicUrl == upload's return, Task 6).
      coverImageUrl: post.coverImageKey ? this.storage.publicUrl(post.coverImageKey) : null,
      categoryName: post.categoryId !== null ? (categoriesById.get(post.categoryId)?.name ?? null) : null,
      categorySlug: post.categoryId !== null ? (categoriesById.get(post.categoryId)?.slug ?? null) : null,
      authorName: post.authorName,
      publishedAt: post.publishedAt,
    }));
    return { items, total, page, pageSize };
  }

  async getPublishedBySlug(
    slug: string,
  ): Promise<BlogPost & { coverImageUrl: string | null; categoryName: string | null; categorySlug: string | null }> {
    // status is part of the lookup key: drafts and unpublished posts 404 here by construction.
    const post = await this.posts.findOneBy({ slug, status: 'published' });
    if (!post) throw new NotFoundException();
    const category = post.categoryId !== null ? await this.categories.findOneBy({ id: post.categoryId }) : null;
    return {
      ...post,
      coverImageUrl: post.coverImageKey ? this.storage.publicUrl(post.coverImageKey) : null,
      categoryName: category?.name ?? null,
      categorySlug: category?.slug ?? null,
    };
  }
}

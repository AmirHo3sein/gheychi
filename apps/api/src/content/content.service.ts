import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { makeSlug } from '../common/slug.util';
import { BlogCategory } from './blog-category.entity';
import { BlogPost, BlogPostStatus } from './blog-post.entity';
import { AdminBlogPostQueryDto, CreateBlogPostDto, UpdateBlogPostDto } from './dto/blog.dto';

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

// Exact message from the Plan 8 spec (§3.2) — surfaced as a toast by the admin panel.
const SLUG_CONFLICT = 'این نامک قبلاً استفاده شده است';

@Injectable()
export class ContentService {
  constructor(@InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>) {}

  async createPost(dto: CreateBlogPostDto): Promise<BlogPost> {
    try {
      return await this.posts.save(
        this.posts.create({
          title: dto.title,
          // Auto slug from the title (spec §3.2); stays editable via updatePost. The 'post'
          // fallbackPrefix (Task 2) gives Persian titles a post-<hex> slug; makeSlug's
          // random suffix makes collisions unlikely, but the DB UNIQUE stays the source of
          // truth — 23505 translated below.
          slug: makeSlug(dto.title, 'post'),
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
      throw err;
    }
  }

  async getPostForAdmin(id: string): Promise<BlogPost> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    return post;
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

    const countWhere: FindOptionsWhere<BlogPost> = {};
    if (status !== 'all') countWhere.status = status;
    if (query.categoryId !== undefined) countWhere.categoryId = query.categoryId;

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

  async deletePost(id: string): Promise<void> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    // Hard delete for any status (spec §3.3) — unpublish is the soft path.
    // Cover-object cleanup lands in Task 6 together with the storage seam.
    await this.posts.delete({ id });
  }
}

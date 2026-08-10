// apps/api/test/blog.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

// A minimal valid 1x1 transparent PNG (real magic-number bytes, not fake/placeholder
// content) -- needed because NestJS's FileTypeValidator does real magic-number sniffing
// via the `file-type` package, not a pure mimetype-string check. Same fixture as
// test/salon-photos.e2e-spec.ts, whose upload pipeline the blog cover endpoint mirrors.
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// Must match the route sitemap-blog.controller.ts exposes: the blog mirror of
// GET /api/sitemap/salon-slugs, extended with updatedAt — which the user-app's
// sitemap route maps to lastmod (spec section 3.5).
const SITEMAP_BLOG_PATH = '/api/sitemap/blog-posts';

const BODY_MARKDOWN = '# انتخاب سالن\n\nمتن **آزمایشی** مطلب بلاگ برای تست چرخه کامل.';

describe('Blog CMS — lifecycle (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let customerCookie: string;
  let categoryId: number;
  let postId: string;
  let firstPublishedAt: string;
  let firstCoverUrl: string;

  // Set via PATCH below -- deterministic, unlike makeSlug's random-suffixed output.
  const postSlug = 'best-hair-salons-tehran-guide';
  const categorySlug = 'skincare-tips';

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09158880001');
    customerCookie = await loginAs(app, '09158880002');
  });

  afterAll(async () => {
    await app.close();
  });

  it('401s anonymous and 403s non-admin callers on the blog admin surface', async () => {
    await request(app.getHttpServer()).get('/api/admin/blog/posts').expect(401);
    await request(app.getHttpServer()).get('/api/admin/blog/posts').set('Cookie', customerCookie).expect(403);
    // Guards run before interceptors, so these rejections write no audit rows and
    // can't disturb the exact multiset asserted at the end of this file.
    await request(app.getHttpServer())
      .post('/api/admin/blog/categories')
      .set('Cookie', customerCookie)
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('creates a category, then renames it with an explicit slug', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/admin/blog/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'Bridal Makeup' })
      .expect(201);
    categoryId = created.body.id;
    expect(created.body.name).toBe('Bridal Makeup');
    // makeSlug appends a random hex suffix, so assert the base, not the whole slug.
    expect(created.body.slug).toContain('bridal-makeup');

    const renamed = await request(app.getHttpServer())
      .patch(`/api/admin/blog/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Skincare Tips', slug: categorySlug })
      .expect(200);
    expect(renamed.body.name).toBe('Skincare Tips');
    expect(renamed.body.slug).toBe(categorySlug);
  });

  it('creates a draft post with an auto slug, then edits it via PATCH including the slug', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/admin/blog/posts')
      .set('Cookie', adminCookie)
      .send({
        title: 'Best Hair Salons in Tehran',
        bodyMarkdown: BODY_MARKDOWN,
        excerpt: 'خلاصه مطلب برای فهرست بلاگ',
        categoryId,
        authorName: 'تیم قیچی',
        metaDescription: 'توضیح متا برای سئو',
        ogTitle: 'عنوان اشتراک‌گذاری بلاگ',
      })
      .expect(201);
    postId = created.body.id;
    expect(created.body.status).toBe('draft');
    expect(created.body.publishedAt).toBeNull();
    expect(created.body.slug).toContain('best-hair-salons-in-tehran');

    const patched = await request(app.getHttpServer())
      .patch(`/api/admin/blog/posts/${postId}`)
      .set('Cookie', adminCookie)
      .send({ slug: postSlug, excerpt: 'راهنمای کامل انتخاب بهترین سالن' })
      .expect(200);
    expect(patched.body.slug).toBe(postSlug);
    expect(patched.body.excerpt).toBe('راهنمای کامل انتخاب بهترین سالن');
  });

  it('keeps the draft entirely off the public surface, while the admin list sees it', async () => {
    const publicList = await request(app.getHttpServer()).get('/api/blog/posts').expect(200);
    expect(publicList.body.total).toBe(0);
    expect(publicList.body.items).toEqual([]);

    await request(app.getHttpServer()).get(`/api/blog/posts/${postSlug}`).expect(404);

    const sitemap = await request(app.getHttpServer()).get(SITEMAP_BLOG_PATH).expect(200);
    expect(sitemap.body.items).toEqual([]);

    const adminList = await request(app.getHttpServer())
      .get('/api/admin/blog/posts')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(adminList.body.total).toBe(1);
    expect(adminList.body.page).toBe(1);
    expect(adminList.body.pageSize).toBe(20);
    expect(adminList.body.items[0].id).toBe(postId);
    expect(adminList.body.items[0].categoryName).toBe('Skincare Tips');

    const publishedOnly = await request(app.getHttpServer())
      .get('/api/admin/blog/posts')
      .set('Cookie', adminCookie)
      .query({ status: 'published' })
      .expect(200);
    expect(publishedOnly.body.total).toBe(0);
  });

  it('publishes the draft, stamping published_at, and 409s a second publish (lost race)', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/publish`)
      .set('Cookie', adminCookie)
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/api/admin/blog/posts/${postId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(detail.body.status).toBe('published');
    expect(detail.body.publishedAt).not.toBeNull();
    firstPublishedAt = detail.body.publishedAt;

    // Conditional update WHERE status='draft': publishing an already-published post is a lost race.
    await request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/publish`)
      .set('Cookie', adminCookie)
      .expect(409);
  });

  it('shows exactly the public-list contract fields — and never bodyMarkdown', async () => {
    const res = await request(app.getHttpServer()).get('/api/blog/posts').expect(200);
    expect(res.body.total).toBe(1);
    const [item] = res.body.items;
    expect(item).toMatchObject({
      id: postId,
      title: 'Best Hair Salons in Tehran',
      slug: postSlug,
      excerpt: 'راهنمای کامل انتخاب بهترین سالن',
      coverImageUrl: null,
      categoryName: 'Skincare Tips',
      categorySlug: 'skincare-tips',
      authorName: 'تیم قیچی',
    });
    expect(new Date(item.publishedAt).getTime()).toBe(new Date(firstPublishedAt).getTime());
    expect(item).not.toHaveProperty('bodyMarkdown');
    expect(item).not.toHaveProperty('body_markdown');

    const filtered = await request(app.getHttpServer())
      .get('/api/blog/posts')
      .query({ category: categorySlug })
      .expect(200);
    expect(filtered.body.total).toBe(1);

    const other = await request(app.getHttpServer())
      .get('/api/blog/posts')
      .query({ category: 'no-such-category' })
      .expect(200);
    expect(other.body.total).toBe(0);
  });

  it('uploads a cover and exposes coverImageUrl on the public surface', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/cover`)
      .set('Cookie', adminCookie)
      .attach('file', MINIMAL_PNG, { filename: 'cover.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const list = await request(app.getHttpServer()).get('/api/blog/posts').expect(200);
    expect(list.body.items[0].coverImageUrl).toContain('/uploads/');
    firstCoverUrl = list.body.items[0].coverImageUrl;
  });

  it('rejects real image bytes declared under a spoofed, disallowed Content-Type (stored-XSS guard)', () =>
    // The magic-number validator alone would PASS this (the bytes really are a PNG) --
    // exactly the gap that let a crafted upload get persisted with an attacker-chosen S3
    // Content-Type despite carrying real image content. file.mimetype must independently
    // match the allowed set too.
    request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/cover`)
      .set('Cookie', adminCookie)
      .attach('file', MINIMAL_PNG, { filename: 'cover.png', contentType: 'text/html' })
      .expect(400));

  it('returns the full article by slug, body and SEO fields included', async () => {
    const res = await request(app.getHttpServer()).get(`/api/blog/posts/${postSlug}`).expect(200);
    expect(res.body.title).toBe('Best Hair Salons in Tehran');
    expect(res.body.bodyMarkdown).toBe(BODY_MARKDOWN);
    expect(res.body.metaDescription).toBe('توضیح متا برای سئو');
    expect(res.body.ogTitle).toBe('عنوان اشتراک‌گذاری بلاگ');
    expect(res.body.authorName).toBe('تیم قیچی');
    expect(res.body.categoryName).toBe('Skincare Tips');
    expect(res.body.categorySlug).toBe(categorySlug);
    expect(res.body.coverImageUrl).toContain('/uploads/');
  });

  it('replaces the cover with a new object, then deletes it, nulling coverImageUrl', async () => {
    // Replace path: a second upload swaps in a fresh storage key (randomUUID-based),
    // so the URL must change, not just stay a valid /uploads/ URL.
    await request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/cover`)
      .set('Cookie', adminCookie)
      .attach('file', MINIMAL_PNG, { filename: 'cover-2.png', contentType: 'image/png' })
      .expect(201);

    const replaced = await request(app.getHttpServer())
      .get(`/api/admin/blog/posts/${postId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(replaced.body.coverImageUrl).toContain('/uploads/');
    expect(replaced.body.coverImageUrl).not.toBe(firstCoverUrl);

    await request(app.getHttpServer())
      .delete(`/api/admin/blog/posts/${postId}/cover`)
      .set('Cookie', adminCookie)
      .expect(204);

    const detail = await request(app.getHttpServer())
      .get(`/api/admin/blog/posts/${postId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(detail.body.coverImageUrl).toBeNull();

    const list = await request(app.getHttpServer()).get('/api/blog/posts').expect(200);
    expect(list.body.items[0].coverImageUrl).toBeNull();
  });

  it('lists the category publicly', async () => {
    const res = await request(app.getHttpServer()).get('/api/blog/categories').expect(200);
    expect(res.body).toEqual([{ id: categoryId, name: 'Skincare Tips', slug: categorySlug }]);
  });

  it('appears in the blog sitemap once published, with an updatedAt', async () => {
    const res = await request(app.getHttpServer()).get(SITEMAP_BLOG_PATH).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].slug).toBe(postSlug);
    expect(Number.isNaN(new Date(res.body.items[0].updatedAt).getTime())).toBe(false);
  });

  it('keeps the original published_at across unpublish → republish', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/unpublish`)
      .set('Cookie', adminCookie)
      .expect(200);
    await request(app.getHttpServer()).get(`/api/blog/posts/${postSlug}`).expect(404);

    await request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/publish`)
      .set('Cookie', adminCookie)
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/api/admin/blog/posts/${postId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(detail.body.status).toBe('published');
    // Republish must NOT restamp: published_at is written only while currently null (first publish).
    expect(new Date(detail.body.publishedAt).getTime()).toBe(new Date(firstPublishedAt).getTime());
  });

  it('unpublishes: public 404, empty list, out of the sitemap — and 409s a repeat unpublish', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/unpublish`)
      .set('Cookie', adminCookie)
      .expect(200);

    const list = await request(app.getHttpServer()).get('/api/blog/posts').expect(200);
    expect(list.body.total).toBe(0);
    await request(app.getHttpServer()).get(`/api/blog/posts/${postSlug}`).expect(404);
    const sitemap = await request(app.getHttpServer()).get(SITEMAP_BLOG_PATH).expect(200);
    expect(sitemap.body.items).toEqual([]);

    // Conditional update WHERE status='published': unpublishing a draft is a lost race.
    await request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/unpublish`)
      .set('Cookie', adminCookie)
      .expect(409);
  });

  it('restricts category delete while a post references it, then allows it once the post is gone', async () => {
    const conflict = await request(app.getHttpServer())
      .delete(`/api/admin/blog/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .expect(409);
    expect(conflict.body.message).toBe('این دسته‌بندی دارای مطلب است و قابل حذف نیست');

    await request(app.getHttpServer())
      .delete(`/api/admin/blog/posts/${postId}`)
      .set('Cookie', adminCookie)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/api/admin/blog/posts/${postId}`)
      .set('Cookie', adminCookie)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/admin/blog/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .expect(204);
    const categories = await request(app.getHttpServer()).get('/api/blog/categories').expect(200);
    expect(categories.body).toEqual([]);
  });

  it('wrote one audit row per admin mutation exercised — checked in a single query', async () => {
    // Single direct query, no polling: the AuditInterceptor awaits its insert on both the
    // success and failure paths before the HTTP response goes out (see the class comment in
    // src/audit/audit.interceptor.ts), and resetDatabase() makes this file the fresh schema's
    // sole writer, so the multiset below is exact -- same invariant reports.e2e-spec.ts uses
    // for its notification-count assertion.
    const ds = app.get(DataSource);
    const rows: Array<{ action: string; target_type: string; target_id: string | null; success: boolean }> =
      await ds.query(
        `SELECT action, target_type, target_id, success FROM audit_log
         WHERE action LIKE 'post.%' OR action LIKE 'blogcategory.%'
         ORDER BY created_at ASC`,
      );

    expect(rows.map((r) => `${r.action}|${r.success}`).sort()).toEqual(
      [
        'blogcategory.create|true', // create category
        'blogcategory.update|true', // rename category
        'blogcategory.delete|false', // restrict-delete 409 while the post referenced it
        'blogcategory.delete|true', // final delete
        'post.create|true',
        'post.update|true', // PATCH slug/excerpt
        'post.publish|true', // first publish
        'post.publish|false', // publish-again lost race (409)
        'post.publish|true', // republish after unpublish
        'post.cover.upload|true', // first cover upload
        'post.cover.upload|false', // spoofed Content-Type upload rejected (stored-XSS guard)
        'post.cover.upload|true', // cover replace (second upload)
        'post.cover.remove|true', // cover delete — its own distinct action string, not shared with upload
        'post.unpublish|true', // first unpublish
        'post.unpublish|true', // final unpublish
        'post.unpublish|false', // unpublish-a-draft lost race (409)
        'post.delete|true',
      ].sort(),
    );

    for (const row of rows) {
      expect(row.target_type).toBe(row.action.startsWith('post.') ? 'post' : 'blogcategory');
    }
    // The interceptor takes target_id from req.params.id, so the two :id-less create routes log null.
    expect(rows.find((r) => r.action === 'post.create')!.target_id).toBeNull();
    expect(rows.find((r) => r.action === 'blogcategory.create')!.target_id).toBeNull();
    for (const row of rows.filter((r) => r.action.startsWith('post.') && r.action !== 'post.create')) {
      expect(row.target_id).toBe(postId);
    }
    for (const row of rows.filter(
      (r) => r.action.startsWith('blogcategory.') && r.action !== 'blogcategory.create',
    )) {
      expect(row.target_id).toBe(String(categoryId));
    }
  });
});

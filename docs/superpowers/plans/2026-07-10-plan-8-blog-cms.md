# Plan 8: Blog / Content CMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lean Persian blog for content marketing — admins author Markdown posts in the admin panel; the user-app serves them as SEO-optimized public pages.

**Architecture:** A custom NestJS content module on existing conventions — one migration (blog_categories + blog_posts), a ContentService with conditional-update publish transitions, admin controllers fully audited through Plan 7's decorator seam, cover images via the swappable StorageProvider, and a public surface (paginated published lists, by-slug, categories, sitemap source). Posts store raw Markdown; both frontends render with `markdown-it` configured `html: false`, making the pipeline XSS-safe by construction (each app's renderer ships an invariant test). The admin panel gets a list page + a Markdown editor with live preview; the user-app gets SSR `/blog` and `/blog/[slug]` pages with `useSeoMeta` + JSON-LD Article + sitemap inclusion.

**Tech Stack:** NestJS 11 + TypeORM raw-SQL migration + PostgreSQL; markdown-it (html:false) in both frontends; Vue 3 admin-panel (Vitest + happy-dom); Nuxt 4 user-app (Vitest unit + nuxt env). All commands run from the repo root (`~/projects/Gheychi`, WSL).

**Approved spec:** `docs/superpowers/specs/2026-07-10-plan-8-blog-cms-design.md`

**Task order:** Tasks execute in numeric order 1–14. Dependency spine: Task 1 (migration) precedes everything; Task 2 (slug util move) precedes 3; Tasks 3–5 (entities/service/admin controllers) precede 6–8; Task 6 (cover/storage seam) and Task 7 (public + sitemap) precede Task 8 (e2e); backend 1–8 precede admin-panel 9–11 and user-app 12–13; Task 14 (docs + full verification) is last. Task 9 must run before Task 11 (the editor imports Task 9's markdown utility — Task 11 preflights this).

**Standing warnings:** the frontend e2e global-setups wipe the shared dev database — reseed demo data after any frontend e2e run. The user-app `typecheck` has a known pre-existing failure (vite 7/6 Plugin type conflict) — gate on tests + build, never on typecheck. The docker CLI inside WSL is unreliable — use the API's migration/test scripts directly (DB ports are reachable).

---

### Task 1: Blog CMS migration — `blog_categories` + `blog_posts`

**Files:**
- Create: `apps/api/src/migrations/1752600000000-blog-cms.ts`

The single migration for the whole plan (no other task adds one), with the exact SQL from spec §2. **This task owns the schema only** — the two entity classes (`BlogCategory`, `BlogPost`) are created by Task 3 alongside `ContentModule`, because `app.module.ts` uses `autoLoadEntities: true` and an entity only matters once a module calls `TypeOrmModule.forFeature(...)` on it.

For reference, the entity property names the rest of the plan uses against these tables (defined in Task 3): `BlogCategory { id, name, slug }`, `BlogPost { id, title, slug, excerpt, bodyMarkdown, coverImageKey, categoryId, authorName, metaDescription, ogTitle, status, publishedAt, createdAt, updatedAt }`.

There is no unit test for raw-SQL migrations in this repo; the verification is run → inspect → revert → inspect → re-run against the dev DB (Postgres on `localhost:5544` inside WSL, per `apps/api/.env`). The `docker` CLI is broken in this WSL — do **not** use `docker compose exec ... psql` for inspection; use the `typeorm-ts-node-commonjs query` CLI (already available via the repo's `typeorm` dependency, same binary the `migration:run` script uses) with the existing data source.

- [ ] **Step 1: Write the migration**

The SQL is spec §2 verbatim, split into one `q.query` per statement in the style of `1752500000000-platform-hardening.ts`. `blog_posts.category_id` is a bare `REFERENCES` (no `ON DELETE` clause), so deleting a category with posts raises `23503`, which the service layer later translates to a Farsi 409. The `down` drops `blog_posts` before `blog_categories` (FK order); indexes drop with their tables.

```typescript
// apps/api/src/migrations/1752600000000-blog-cms.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class BlogCms1752600000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE blog_categories (
        id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name varchar(60) NOT NULL UNIQUE,
        slug varchar(80) NOT NULL UNIQUE
      )`);

    await q.query(`
      CREATE TABLE blog_posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title varchar(200) NOT NULL,
        slug varchar(220) NOT NULL UNIQUE,
        excerpt varchar(500),
        body_markdown text NOT NULL,
        cover_image_key varchar(500),
        category_id int REFERENCES blog_categories(id),   -- bare FK: delete restricts (23503 → 409)
        author_name varchar(80),
        meta_description varchar(300),
        og_title varchar(200),
        status varchar(20) NOT NULL DEFAULT 'draft',       -- 'draft' | 'published'
        published_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX blog_posts_public_idx ON blog_posts (status, published_at DESC)`);
    await q.query(`CREATE INDEX blog_posts_category_idx ON blog_posts (category_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE blog_posts`);
    await q.query(`DROP TABLE blog_categories`);
  }
}
```

- [ ] **Step 2: Run the migration against the dev DB**

Run (repo root, docker services already up): `pnpm --filter @gheychi/api migration:run`
Expected: exit 0 with `Migration BlogCms1752600000000 has been executed successfully.`

- [ ] **Step 3: Verify the schema landed**

Run each command bare and check its exit code — no pipes. `typeorm-ts-node-commonjs query` prints the result rows as JSON.

Run:
```bash
pnpm --filter @gheychi/api exec -- typeorm-ts-node-commonjs query "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'blog_posts' ORDER BY ordinal_position" -d src/data-source.ts
```
Expected: exit 0 and 14 rows — `id` (uuid, default `gen_random_uuid()`), `title`, `slug`, `excerpt`, `body_markdown` (text, NOT NULL), `cover_image_key`, `category_id` (integer, nullable), `author_name`, `meta_description`, `og_title`, `status` (NOT NULL, default `'draft'::character varying`), `published_at` (timestamptz, nullable), `created_at`, `updated_at` (both timestamptz NOT NULL, default `now()`).

Run:
```bash
pnpm --filter @gheychi/api exec -- typeorm-ts-node-commonjs query "SELECT indexname FROM pg_indexes WHERE tablename IN ('blog_categories','blog_posts') ORDER BY indexname" -d src/data-source.ts
```
Expected: exit 0 and exactly these seven indexes: `blog_categories_name_key`, `blog_categories_pkey`, `blog_categories_slug_key`, `blog_posts_category_idx`, `blog_posts_pkey`, `blog_posts_public_idx`, `blog_posts_slug_key`.

- [ ] **Step 4: Revert-test the down migration, then re-apply**

Run: `pnpm --filter @gheychi/api migration:revert`
Expected: exit 0 with `Migration BlogCms1752600000000 has been reverted successfully.`

Run:
```bash
pnpm --filter @gheychi/api exec -- typeorm-ts-node-commonjs query "SELECT to_regclass('public.blog_posts') AS blog_posts, to_regclass('public.blog_categories') AS blog_categories" -d src/data-source.ts
```
Expected: exit 0 and one row with both columns `null` — both tables gone.

Run: `pnpm --filter @gheychi/api migration:run`
Expected: executed successfully again (leave the dev DB migrated).

The e2e test DB needs nothing manual — `test/utils/db.ts` `resetDatabase()` runs all migrations (`ds.runMigrations()`) before each e2e suite, so it picks this one up automatically.

- [ ] **Step 5: Confirm the build and existing suites are untouched**

Run: `pnpm --filter @gheychi/api build`
Expected: exit 0, clean `nest build` (the migration file lives under `src/` and must type-check).

Run: `pnpm --filter @gheychi/api test`
Expected: exit 0, all existing unit suites PASS (the migration is purely additive; nothing consumes the tables yet).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/migrations/1752600000000-blog-cms.ts
git commit -m "feat(api): blog CMS schema — blog_categories, blog_posts, public/category indexes"
```

---

### Task 2: Move the slug utility to `src/common/slug.util.ts`

**Files:**
- Create: `apps/api/src/common/slug.util.ts` (moved from `apps/api/src/salons/slug.util.ts`)
- Test: `apps/api/src/common/slug.util.spec.ts` (moved + adapted from `apps/api/src/salons/slug.util.spec.ts`)
- Modify: `apps/api/src/salons/salons.service.ts:8` (import path only)
- Delete: `apps/api/src/salons/slug.util.ts`, `apps/api/src/salons/slug.util.spec.ts`

Spec §3.2: the existing slug utility is salon-specific only in one place — its short-input fallback hardcodes a `salon-` prefix (`makeSlug('سالن رز')` → `salon-a1b2c3d4`, because Persian characters strip to an empty base). Blog posts in this product have Persian titles as the norm, so **every** blog slug would read `salon-…` if we moved the function untouched. The move therefore adds one optional parameter, `fallbackPrefix` (default `'salon'`), which keeps the salons call site byte-for-byte identical in behavior while letting `ContentService.createPost` (Task 3) call `makeSlug(title, 'post')`. That is the entire adaptation — algorithm, suffix lengths, and default behavior are unchanged, per the spec's "targeted improvement, not a refactor" framing.

Grep-verified call sites of `./slug.util` before this task (there are exactly two): `src/salons/salons.service.ts:8` and the colocated spec. All later Plan 8 tasks import from `'../common/slug.util'`.

- [ ] **Step 1: Write the failing test at the new location**

The three original cases carry over verbatim; two new cases pin the `fallbackPrefix` parameter (used and ignored).

```typescript
// apps/api/src/common/slug.util.spec.ts
import { makeSlug } from './slug.util';

describe('makeSlug', () => {
  it('slugifies latin names and appends a 4-hex suffix', () => {
    const slug = makeSlug('VIP Beauty Salon');
    expect(slug).toMatch(/^vip-beauty-salon-[0-9a-f]{4}$/);
  });

  it('falls back to salon-<hex> for non-latin (Persian) names by default', () => {
    const slug = makeSlug('سالن رز');
    expect(slug).toMatch(/^salon-[0-9a-f]{8}$/);
  });

  it('uses a custom fallback prefix for non-latin names when given one', () => {
    const slug = makeSlug('راهنمای رنگ مو', 'post');
    expect(slug).toMatch(/^post-[0-9a-f]{8}$/);
  });

  it('ignores the fallback prefix when the name slugifies cleanly', () => {
    const slug = makeSlug('Hair Color Guide', 'post');
    expect(slug).toMatch(/^hair-color-guide-[0-9a-f]{4}$/);
  });

  it('generates unique slugs for the same name', () => {
    expect(makeSlug('Rose')).not.toBe(makeSlug('Rose'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gheychi/api test -- slug.util`
Expected: FAIL — `src/common/slug.util.spec.ts` errors with `Cannot find module './slug.util'` (the legacy `src/salons/slug.util.spec.ts` still passes in the same run; it is removed in Step 4).

- [ ] **Step 3: Write the moved implementation**

The body is the existing `src/salons/slug.util.ts` with the fallback prefix lifted into a defaulted parameter — nothing else changes.

```typescript
// apps/api/src/common/slug.util.ts
import { randomBytes } from 'crypto';

export function makeSlug(name: string, fallbackPrefix = 'salon'): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length < 3) return `${fallbackPrefix}-${randomBytes(4).toString('hex')}`;
  return `${base}-${randomBytes(2).toString('hex')}`;
}
```

Run: `pnpm --filter @gheychi/api test -- slug.util`
Expected: PASS — both `src/common/slug.util.spec.ts` (5 tests) and the not-yet-deleted `src/salons/slug.util.spec.ts` (3 tests) green.

- [ ] **Step 4: Repoint the salons import and delete the old files**

In `apps/api/src/salons/salons.service.ts`, line 8 currently reads (amid the import block ending with `import { Salon } from './salon.entity';` on line 7):

```typescript
import { makeSlug } from './slug.util';
```

Change it to:

```typescript
import { makeSlug } from '../common/slug.util';
```

The single usage at line 28 (`slug: makeSlug(dto.name),` inside `createForOwner`) stays exactly as is — the default `'salon'` fallback preserves current behavior.

Then remove the old pair:

```bash
git rm apps/api/src/salons/slug.util.ts apps/api/src/salons/slug.util.spec.ts
```

- [ ] **Step 5: Full unit suite + build green**

Run: `pnpm --filter @gheychi/api test`
Expected: exit 0 — the full unit suite PASSES, with `slug.util.spec.ts` now reported only under `src/common/`.

Run: `pnpm --filter @gheychi/api build`
Expected: exit 0, clean `nest build` (proves no stale `./slug.util` import survived anywhere).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/slug.util.ts apps/api/src/common/slug.util.spec.ts apps/api/src/salons/salons.service.ts
git commit -m "refactor(api): move makeSlug to src/common with an optional fallback prefix for blog slugs"
```

---

### Task 3: Blog entities, DTOs, `ContentModule`, and `ContentService` post-CRUD core

**Files:**
- Test: `apps/api/src/content/content.service.spec.ts` (create)
- Create: `apps/api/src/content/blog-category.entity.ts`
- Create: `apps/api/src/content/blog-post.entity.ts`
- Create: `apps/api/src/content/dto/blog.dto.ts`
- Create: `apps/api/src/content/content.service.ts`
- Create: `apps/api/src/content/content.module.ts`
- Modify: `apps/api/src/app.module.ts:8,50-51`

The content module's data layer: the two entities (mapping Task 1's DDL exactly — no relation decorators, FKs live only in the migration SQL), the post DTOs, and the four core `ContentService` methods (`createPost`, `updatePost`, `getPostForAdmin`, `listPostsForAdmin`). Publish transitions, categories, and controllers come in Tasks 4–5.

**`categoryName` join decision:** `listPostsForAdmin` uses the raw entity-class-join idiom from `ReportsService.listForAdmin` (a `createQueryBuilder` + `leftJoin(BlogCategory, ...)` + per-column raw aliases) rather than `AuditService`'s second-lookup style. Rationale: category name is a natural single-query SQL join on exactly the page being returned; a second lookup would add a round-trip plus in-memory stitching for no gain, and `ReportsService.listForAdmin` is the closest existing shape (same `{items,total,page,pageSize}` envelope, same joined-context-columns need).

**Slug:** imported from `../common/slug.util` (Task 2 moved it there). Posts call `makeSlug(dto.title, 'post')`, so a Persian title falls back to a random `post-<hex>` slug (Task 2's `fallbackPrefix`) instead of the salon-flavored default — accepted, same tradeoff salons live with; the slug stays editable via `PATCH` (Task 5's endpoint) and the DB `UNIQUE` remains the source of truth (`23505` → 409 «این نامک قبلاً استفاده شده است»).

- [ ] **Step 1: Preflight — confirm Tasks 1–2 landed**

Run: `test -f apps/api/src/migrations/1752600000000-blog-cms.ts`
Expected: exit 0.

Run: `test -f apps/api/src/common/slug.util.ts`
Expected: exit 0. (If either fails, stop — Tasks 1–2 must be complete first.)

- [ ] **Step 2: Write the failing test**

Mocking style mirrors `apps/api/src/reports/reports.service.spec.ts` (repo-object mocks + a chainable QueryBuilder mock + `Test.createTestingModule`). The category repository is wired into `setup()` now even though `ContentService` only injects it in Task 5 — an extra testing-module provider is inert, and this keeps `setup()` stable across all three tasks (Tasks 4–5 only append `describe` blocks). The storage seam is deliberately absent here: it arrives with Task 6, which extends `setup()` then.

```typescript
// apps/api/src/content/content.service.spec.ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryFailedError } from 'typeorm';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';
import { CreateBlogPostDto, UpdateBlogPostDto } from './dto/blog.dto';

interface QueryBuilderMock {
  leftJoin: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  offset: jest.Mock;
  limit: jest.Mock;
  getRawMany: jest.Mock;
}

interface Mocks {
  postsRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  categoriesRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    delete: jest.Mock;
    find: jest.Mock;
  };
  qb: QueryBuilderMock;
}

// Same shape ReportsService's spec uses: a TypeORM QueryFailedError carrying the pg
// driver's code, which is what isUniqueViolation()/isForeignKeyViolation() read.
function pgError(code: string): QueryFailedError {
  const driverError = Object.assign(new Error('db error'), { code });
  return new QueryFailedError('INSERT INTO blog_posts', [], driverError);
}

const draft = (overrides: Partial<BlogPost> = {}): BlogPost =>
  ({
    id: 'post-1',
    title: 'Summer Hair Trends',
    slug: 'summer-hair-trends-ab12',
    excerpt: null,
    bodyMarkdown: '# body',
    coverImageKey: null,
    categoryId: null,
    authorName: null,
    metaDescription: null,
    ogTitle: null,
    status: 'draft',
    publishedAt: null,
    createdAt: new Date('2026-07-01T08:00:00Z'),
    updatedAt: new Date('2026-07-01T08:00:00Z'),
    ...overrides,
  }) as BlogPost;

async function setup(): Promise<{ service: ContentService; mocks: Mocks }> {
  const qb = {} as QueryBuilderMock;
  for (const method of ['leftJoin', 'select', 'addSelect', 'andWhere', 'orderBy', 'offset', 'limit'] as const) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue([]);

  const mocks: Mocks = {
    postsRepo: {
      create: jest.fn((values: Record<string, unknown>) => values),
      save: jest.fn(async (values: Record<string, unknown>) => ({ id: 'post-1', ...values })),
      findOneBy: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    },
    categoriesRepo: {
      create: jest.fn((values: Record<string, unknown>) => values),
      save: jest.fn(async (values: Record<string, unknown>) => ({ id: 1, ...values })),
      findOneBy: jest.fn(),
      delete: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    },
    qb,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ContentService,
      { provide: getRepositoryToken(BlogPost), useValue: mocks.postsRepo },
      { provide: getRepositoryToken(BlogCategory), useValue: mocks.categoriesRepo },
    ],
  }).compile();

  return { service: moduleRef.get(ContentService), mocks };
}

describe('ContentService.createPost', () => {
  it('creates a draft with an auto-generated slug and null optional fields', async () => {
    const { service, mocks } = await setup();

    const post = await service.createPost({ title: 'Summer Hair Trends', bodyMarkdown: '# body' });

    expect(mocks.postsRepo.create).toHaveBeenCalledWith({
      title: 'Summer Hair Trends',
      slug: expect.stringMatching(/^summer-hair-trends-[0-9a-f]{4}$/),
      excerpt: null,
      bodyMarkdown: '# body',
      categoryId: null,
      authorName: null,
      metaDescription: null,
      ogTitle: null,
      status: 'draft',
      publishedAt: null,
    });
    expect(post.id).toBe('post-1');
  });

  it('falls back to a post-prefixed random slug for a Persian title', async () => {
    const { service, mocks } = await setup();

    await service.createPost({ title: 'راهنمای رنگ مو', bodyMarkdown: '# متن' });

    expect(mocks.postsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: expect.stringMatching(/^post-[0-9a-f]{8}$/) }),
    );
  });

  it('carries the optional content/SEO fields through', async () => {
    const { service, mocks } = await setup();

    await service.createPost({
      title: 'Bridal Makeup Guide',
      bodyMarkdown: '## intro',
      excerpt: 'خلاصه مطلب',
      categoryId: 3,
      authorName: 'نگار',
      metaDescription: 'توضیح متا برای گوگل',
      ogTitle: 'عنوان اشتراک‌گذاری',
    });

    expect(mocks.postsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        excerpt: 'خلاصه مطلب',
        categoryId: 3,
        authorName: 'نگار',
        metaDescription: 'توضیح متا برای گوگل',
        ogTitle: 'عنوان اشتراک‌گذاری',
      }),
    );
  });

  it('translates a slug 23505 into the Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.save.mockRejectedValue(pgError('23505'));

    await expect(service.createPost({ title: 'Summer Hair Trends', bodyMarkdown: '# body' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این نامک قبلاً استفاده شده است',
    });
  });

  it('rethrows non-unique-violation errors untouched', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.save.mockRejectedValue(new Error('connection reset'));

    await expect(service.createPost({ title: 'Summer Hair Trends', bodyMarkdown: '# body' })).rejects.toThrow(
      'connection reset',
    );
  });
});

describe('ContentService.updatePost', () => {
  it('404s when the post does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.updatePost('missing', { title: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.postsRepo.save).not.toHaveBeenCalled();
  });

  it('applies only the provided fields and preserves the rest', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft({ categoryId: 3, authorName: 'نگار' }));

    await service.updatePost('post-1', { title: 'New Title', bodyMarkdown: '# new' });

    expect(mocks.postsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'post-1',
        title: 'New Title',
        bodyMarkdown: '# new',
        slug: 'summer-hair-trends-ab12',
        categoryId: 3,
        authorName: 'نگار',
      }),
    );
  });

  it('updates the slug when provided (Persian slugs included)', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());

    await service.updatePost('post-1', { slug: 'رنگ-مو-تابستان' });

    expect(mocks.postsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ slug: 'رنگ-مو-تابستان' }));
  });

  it('clears nullable fields on explicit null and normalizes empty string to null', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(
      draft({ excerpt: 'old', categoryId: 3, authorName: 'نگار', metaDescription: 'old', ogTitle: 'old' }),
    );

    await service.updatePost('post-1', {
      excerpt: null,
      categoryId: null,
      authorName: '',
      metaDescription: null,
      ogTitle: null,
    });

    expect(mocks.postsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ excerpt: null, categoryId: null, authorName: null, metaDescription: null, ogTitle: null }),
    );
  });

  it('translates a slug 23505 on save into the Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());
    mocks.postsRepo.save.mockRejectedValue(pgError('23505'));

    await expect(service.updatePost('post-1', { slug: 'taken-slug' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این نامک قبلاً استفاده شده است',
    });
  });
});

describe('ContentService.getPostForAdmin', () => {
  it('returns the post by id', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());

    await expect(service.getPostForAdmin('post-1')).resolves.toMatchObject({
      id: 'post-1',
      title: 'Summer Hair Trends',
    });
    expect(mocks.postsRepo.findOneBy).toHaveBeenCalledWith({ id: 'post-1' });
  });

  it('404s when the post does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.getPostForAdmin('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ContentService.listPostsForAdmin', () => {
  it("defaults to status 'all' (no status filter) with the standard envelope", async () => {
    const { service, mocks } = await setup();
    mocks.qb.getRawMany.mockResolvedValue([{ id: 'post-1', title: 'Summer Hair Trends', categoryName: 'مو' }]);
    mocks.postsRepo.count.mockResolvedValue(1);

    const result = await service.listPostsForAdmin({});

    expect(result).toEqual({
      items: [{ id: 'post-1', title: 'Summer Hair Trends', categoryName: 'مو' }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(mocks.qb.andWhere).not.toHaveBeenCalled();
    expect(mocks.postsRepo.count).toHaveBeenCalledWith({ where: {} });
    expect(mocks.qb.orderBy).toHaveBeenCalledWith('post.createdAt', 'DESC');
    expect(mocks.qb.offset).toHaveBeenCalledWith(0);
    expect(mocks.qb.limit).toHaveBeenCalledWith(20);
  });

  it('applies the status and categoryId filters and paging to both query and count', async () => {
    const { service, mocks } = await setup();

    await service.listPostsForAdmin({ status: 'draft', categoryId: 3, page: 2, pageSize: 10 });

    expect(mocks.qb.andWhere).toHaveBeenCalledWith('post.status = :status', { status: 'draft' });
    expect(mocks.qb.andWhere).toHaveBeenCalledWith('post.categoryId = :categoryId', { categoryId: 3 });
    expect(mocks.postsRepo.count).toHaveBeenCalledWith({ where: { status: 'draft', categoryId: 3 } });
    expect(mocks.qb.offset).toHaveBeenCalledWith(10);
    expect(mocks.qb.limit).toHaveBeenCalledWith(10);
  });
});

describe('blog post DTOs', () => {
  it('CreateBlogPostDto requires title and bodyMarkdown', async () => {
    const errors = await validate(plainToInstance(CreateBlogPostDto, {}));
    expect(errors.map((e) => e.property)).toEqual(expect.arrayContaining(['title', 'bodyMarkdown']));
  });

  it('CreateBlogPostDto caps title at 200 and excerpt at 500', async () => {
    const errors = await validate(
      plainToInstance(CreateBlogPostDto, { title: 'x'.repeat(201), bodyMarkdown: '#', excerpt: 'y'.repeat(501) }),
    );
    expect(errors.map((e) => e.property)).toEqual(expect.arrayContaining(['title', 'excerpt']));
  });

  it('CreateBlogPostDto accepts a minimal valid payload', async () => {
    await expect(
      validate(plainToInstance(CreateBlogPostDto, { title: 'ترندهای رنگ مو', bodyMarkdown: '# متن' })),
    ).resolves.toEqual([]);
  });

  it('UpdateBlogPostDto accepts a Persian slug and rejects one with whitespace', async () => {
    await expect(validate(plainToInstance(UpdateBlogPostDto, { slug: 'رنگ-مو-تابستان' }))).resolves.toEqual([]);
    const errors = await validate(plainToInstance(UpdateBlogPostDto, { slug: 'has space' }));
    expect(errors.map((e) => e.property)).toContain('slug');
  });

  it('UpdateBlogPostDto caps metaDescription 300 / ogTitle 200 / authorName 80', async () => {
    const errors = await validate(
      plainToInstance(UpdateBlogPostDto, {
        metaDescription: 'x'.repeat(301),
        ogTitle: 'x'.repeat(201),
        authorName: 'x'.repeat(81),
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(expect.arrayContaining(['metaDescription', 'ogTitle', 'authorName']));
  });

  it('UpdateBlogPostDto lets explicit nulls through for clearing nullable fields', async () => {
    await expect(
      validate(plainToInstance(UpdateBlogPostDto, { excerpt: null, categoryId: null, metaDescription: null })),
    ).resolves.toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @gheychi/api test -- content.service`
Expected: FAIL — TS compile errors, `Cannot find module './blog-category.entity'` / `'./blog-post.entity'` / `'./content.service'` / `'./dto/blog.dto'` (none exist yet).

- [ ] **Step 4: Write the entities**

Repo convention: plain FK-id columns, explicit snake_case `@Column({ name })`, no relation decorators (see `Report` / `ServiceCategory` for the precedent). `updated_at` is maintained by `@UpdateDateColumn` per the spec.

```typescript
// apps/api/src/content/blog-category.entity.ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('blog_categories')
export class BlogCategory {
  @PrimaryGeneratedColumn('identity')
  id: number;

  @Column({ unique: true })
  name: string;

  @Column({ unique: true })
  slug: string;
}
```

```typescript
// apps/api/src/content/blog-post.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type BlogPostStatus = 'draft' | 'published';

@Entity('blog_posts')
export class BlogPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'varchar', nullable: true })
  excerpt: string | null;

  @Column({ name: 'body_markdown', type: 'text' })
  bodyMarkdown: string;

  @Column({ name: 'cover_image_key', type: 'varchar', nullable: true })
  coverImageKey: string | null;

  // Bare FK — blog_posts.category_id REFERENCES blog_categories(id) lives only in the
  // migration SQL (NO ACTION: category delete restricts, 23503 → 409 in Task 5).
  @Column({ name: 'category_id', type: 'int', nullable: true })
  categoryId: number | null;

  @Column({ name: 'author_name', type: 'varchar', nullable: true })
  authorName: string | null;

  @Column({ name: 'meta_description', type: 'varchar', nullable: true })
  metaDescription: string | null;

  @Column({ name: 'og_title', type: 'varchar', nullable: true })
  ogTitle: string | null;

  @Column({ type: 'varchar', default: 'draft' })
  status: BlogPostStatus;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

- [ ] **Step 5: Diff the entities against Task 1's migration DDL**

Open `apps/api/src/migrations/1752600000000-blog-cms.ts` and verify every column maps (`synchronize: false`, so the entity must agree with the migration, not the other way around):

| Entity property | Column name | Migration DDL |
|---|---|---|
| `BlogCategory.id` | `id` | `int GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `BlogCategory.name` | `name` | `varchar(60) NOT NULL UNIQUE` |
| `BlogCategory.slug` | `slug` | `varchar(80) NOT NULL UNIQUE` |
| `BlogPost.id` | `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `BlogPost.title` | `title` | `varchar(200) NOT NULL` |
| `BlogPost.slug` | `slug` | `varchar(220) NOT NULL UNIQUE` |
| `BlogPost.excerpt` | `excerpt` | `varchar(500)` (nullable) |
| `BlogPost.bodyMarkdown` | `body_markdown` | `text NOT NULL` |
| `BlogPost.coverImageKey` | `cover_image_key` | `varchar(500)` (nullable) |
| `BlogPost.categoryId` | `category_id` | `int REFERENCES blog_categories(id)` (nullable) |
| `BlogPost.authorName` | `author_name` | `varchar(80)` (nullable) |
| `BlogPost.metaDescription` | `meta_description` | `varchar(300)` (nullable) |
| `BlogPost.ogTitle` | `og_title` | `varchar(200)` (nullable) |
| `BlogPost.status` | `status` | `varchar(20) NOT NULL DEFAULT 'draft'` |
| `BlogPost.publishedAt` | `published_at` | `timestamptz` (nullable) |
| `BlogPost.createdAt` | `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `BlogPost.updatedAt` | `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

Any mismatch (a column name, nullability, or a column present on one side only) must be fixed on the **entity** side before proceeding.

- [ ] **Step 6: Write the DTOs**

Caps come straight from the DDL/spec: title 1–200 required, bodyMarkdown required min 1, excerpt ≤500, metaDescription ≤300, ogTitle ≤200, authorName ≤80, categoryId optional int. Nullable fields accept explicit `null` (`@IsOptional()` passes both `undefined` and `null`) so a PATCH can clear them; `class-transformer` leaves `null` untouched by `@Type(() => Number)`.

```typescript
// apps/api/src/content/dto/blog.dto.ts
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
```

- [ ] **Step 7: Write `ContentService` (core methods)**

```typescript
// apps/api/src/content/content.service.ts
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
}
```

- [ ] **Step 8: Write `ContentModule` and register it in `AppModule`**

Both entities go into `forFeature` now — `autoLoadEntities` needs `BlogCategory` registered for the query-builder join metadata even though its repository is only injected in Task 5.

```typescript
// apps/api/src/content/content.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';

@Module({
  imports: [TypeOrmModule.forFeature([BlogPost, BlogCategory])],
  providers: [ContentService],
})
export class ContentModule {}
```

In `apps/api/src/app.module.ts`, the import block currently reads (alphabetical by path):

```typescript
import { BookingModule } from './booking/booking.module';
import { CatalogModule } from './catalog/catalog.module';
import { FavoritesModule } from './favorites/favorites.module';
```

Insert the new import between `CatalogModule` and `FavoritesModule`:

```typescript
import { BookingModule } from './booking/booking.module';
import { CatalogModule } from './catalog/catalog.module';
import { ContentModule } from './content/content.module';
import { FavoritesModule } from './favorites/favorites.module';
```

And the imports array currently ends:

```typescript
    FavoritesModule,
    PushModule,
    AdminNotificationsModule,
  ],
  controllers: [HealthController],
```

becomes:

```typescript
    FavoritesModule,
    PushModule,
    AdminNotificationsModule,
    ContentModule,
  ],
  controllers: [HealthController],
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test -- content.service`
Expected: PASS (20 tests).

- [ ] **Step 10: Run the full unit suite**

Run: `pnpm --filter @gheychi/api test`
Expected: exit 0, no other suite disturbed.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/content apps/api/src/app.module.ts
git commit -m "feat(api): blog entities, DTOs, and ContentService post-CRUD core"
```

---

### Task 4: Publish / unpublish / delete transitions

**Files:**
- Test: `apps/api/src/content/content.service.spec.ts` (extend)
- Modify: `apps/api/src/content/content.service.ts`

The workflow methods, all per the locked contract semantics:

- `publishPost` — conditional update `WHERE status='draft'`; stamps `published_at` **only** when it is currently null, so a republish (after unpublish) keeps the original date; `affected === 0` → 409 Farsi. Same lost-race idiom as `SalonsService.resubmitMine()` / `ReportsService.resolve()`.
- `unpublishPost` — conditional `WHERE status='published'`; `published_at` untouched; 409 Farsi on race/wrong-state.
- `deletePost` — `findOneBy` → 404 → hard delete, for any status. (No cover-object cleanup here — the storage seam and the best-effort cleanup both arrive with Task 6, which owns everything cover-related.)

The spec gives no exact Farsi strings for the transition 409s, so these two are fixed here and become part of the plan's contract for the admin-panel task: publish race → «این مطلب قبلاً منتشر شده است», unpublish race → «این مطلب در حال حاضر منتشر نیست».

`ContentService` gains no new dependencies in this task — only `describe` blocks are appended to the spec (`setup()` is untouched).

- [ ] **Step 1: Extend the failing test**

Append to the end of `apps/api/src/content/content.service.spec.ts`:

```typescript
describe('ContentService.publishPost', () => {
  it('404s when the post does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.publishPost('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.postsRepo.update).not.toHaveBeenCalled();
  });

  it('publishes a never-published draft and stamps published_at, conditioned on status=draft', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy
      .mockResolvedValueOnce(draft())
      .mockResolvedValueOnce(draft({ status: 'published', publishedAt: new Date() }));
    mocks.postsRepo.update.mockResolvedValue({ affected: 1 });

    const result = await service.publishPost('post-1');

    expect(mocks.postsRepo.update).toHaveBeenCalledWith(
      { id: 'post-1', status: 'draft' },
      { status: 'published', publishedAt: expect.any(Date) },
    );
    expect(result.status).toBe('published');
  });

  it('keeps the original published_at on republish (no re-stamp)', async () => {
    const { service, mocks } = await setup();
    const original = new Date('2026-06-01T09:00:00Z');
    mocks.postsRepo.findOneBy
      .mockResolvedValueOnce(draft({ publishedAt: original }))
      .mockResolvedValueOnce(draft({ status: 'published', publishedAt: original }));
    mocks.postsRepo.update.mockResolvedValue({ affected: 1 });

    await service.publishPost('post-1');

    // Exact payload equality: publishedAt must NOT be part of the update when already set.
    expect(mocks.postsRepo.update).toHaveBeenCalledWith({ id: 'post-1', status: 'draft' }, { status: 'published' });
  });

  it('409s in Farsi when the conditional draft-only update loses a race', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());
    mocks.postsRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.publishPost('post-1')).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این مطلب قبلاً منتشر شده است',
    });
  });
});

describe('ContentService.unpublishPost', () => {
  it('404s when the post does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.unpublishPost('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.postsRepo.update).not.toHaveBeenCalled();
  });

  it('unpublishes via a conditional published-only update and keeps published_at', async () => {
    const { service, mocks } = await setup();
    const original = new Date('2026-06-01T09:00:00Z');
    mocks.postsRepo.findOneBy
      .mockResolvedValueOnce(draft({ status: 'published', publishedAt: original }))
      .mockResolvedValueOnce(draft({ status: 'draft', publishedAt: original }));
    mocks.postsRepo.update.mockResolvedValue({ affected: 1 });

    const result = await service.unpublishPost('post-1');

    // Exact payload: published_at is untouched so a later republish keeps the original date.
    expect(mocks.postsRepo.update).toHaveBeenCalledWith({ id: 'post-1', status: 'published' }, { status: 'draft' });
    expect(result.publishedAt).toEqual(original);
  });

  it('409s in Farsi when the post is not currently published', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());
    mocks.postsRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.unpublishPost('post-1')).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این مطلب در حال حاضر منتشر نیست',
    });
  });
});

describe('ContentService.deletePost', () => {
  it('404s when the post does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.deletePost('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.postsRepo.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes the row for any status', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft({ status: 'published' }));
    mocks.postsRepo.delete.mockResolvedValue({ affected: 1 });

    await service.deletePost('post-1');

    expect(mocks.postsRepo.delete).toHaveBeenCalledWith({ id: 'post-1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gheychi/api test -- content.service`
Expected: FAIL — TS compile errors, `Property 'publishPost' does not exist on type 'ContentService'` (likewise `unpublishPost`, `deletePost`).

- [ ] **Step 3: Implement the transitions**

In `apps/api/src/content/content.service.ts` (imports and constructor stay exactly as Task 3 left them), append the three methods to the class, after `listPostsForAdmin`:

```typescript
  async publishPost(id: string): Promise<BlogPost> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    // Conditional update WHERE status='draft' — the same lost-race guard as
    // SalonsService.resubmitMine() / ReportsService.resolve(): a concurrent publish
    // affects 0 rows here and the loser gets a clear 409 instead of double-stamping.
    // published_at is stamped only on FIRST publish; a republish (after unpublish)
    // keeps the original date so public ordering and SEO dates stay stable.
    const result = await this.posts.update(
      { id, status: 'draft' },
      post.publishedAt ? { status: 'published' } : { status: 'published', publishedAt: new Date() },
    );
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test -- content.service`
Expected: PASS (29 tests).

- [ ] **Step 5: Run the full unit suite**

Run: `pnpm --filter @gheychi/api test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/content
git commit -m "feat(api): blog publish/unpublish/delete with conditional-update race guards"
```

---

### Task 5: Admin blog controller — posts, categories, audit wiring

**Files:**
- Test: `apps/api/src/content/content.service.spec.ts` (extend)
- Test: `apps/api/src/audit/audit-wiring.spec.ts` (extend, 18 → 34 tests)
- Create: `apps/api/src/content/admin-blog.controller.ts`
- Modify: `apps/api/src/content/dto/blog.dto.ts`
- Modify: `apps/api/src/content/content.service.ts`
- Modify: `apps/api/src/content/content.module.ts`

The admin surface from spec §3.3 in one controller (`/api/admin/blog/*`) — everything except the two cover endpoints, which belong to Task 6 (they need the storage seam; Task 6 adds them to this same controller) — plus the remaining `ContentService` methods it needs: `createCategory` / `updateCategory` / `deleteCategory` / `listCategories`. Every mutation handler carries `@UseInterceptors(AuditInterceptor)` + `@AuditAction(...)` with eight of the contract's nine action strings (the ninth, `post.cover.set`, ships with Task 6's cover handlers).

**Farsi 409s:** category-in-use delete uses the exact contract string «این دسته‌بندی دارای مطلب است و قابل حذف نیست» via `isForeignKeyViolation` (no pre-check — Postgres is the source of truth, same as `AdminCategoriesController.remove()`). The spec fixes no text for a duplicate category, so this plan fixes it as «دسته‌بندی با این نام یا نامک از قبل وجود دارد» (name and slug are both `UNIQUE`, one message covers both).

**Audit wiring count:** exactly eight new cases here (18 → 34) — the five post actions plus the three category actions. The ninth contract case, `post.cover.set`, is added by Task 6 alongside the cover handlers (34 → 36).

- [ ] **Step 1: Extend the failing service test**

In `apps/api/src/content/content.service.spec.ts`, widen the DTO import line. Currently:

```typescript
import { CreateBlogPostDto, UpdateBlogPostDto } from './dto/blog.dto';
```

becomes:

```typescript
import { CreateBlogCategoryDto, CreateBlogPostDto, UpdateBlogCategoryDto, UpdateBlogPostDto } from './dto/blog.dto';
```

Then append to the end of the file:

```typescript
describe('ContentService.createCategory', () => {
  it('auto-generates the slug from the name when none is provided', async () => {
    const { service, mocks } = await setup();

    const category = await service.createCategory({ name: 'Hair Care' });

    expect(mocks.categoriesRepo.create).toHaveBeenCalledWith({
      name: 'Hair Care',
      slug: expect.stringMatching(/^hair-care-[0-9a-f]{4}$/),
    });
    expect(category.id).toBe(1);
  });

  it('pins an explicitly provided slug', async () => {
    const { service, mocks } = await setup();

    await service.createCategory({ name: 'مراقبت از مو', slug: 'مراقبت-مو' });

    expect(mocks.categoriesRepo.create).toHaveBeenCalledWith({ name: 'مراقبت از مو', slug: 'مراقبت-مو' });
  });

  it('translates a duplicate name/slug 23505 into the Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.save.mockRejectedValue(pgError('23505'));

    await expect(service.createCategory({ name: 'Hair Care' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'دسته‌بندی با این نام یا نامک از قبل وجود دارد',
    });
  });

  it('rethrows non-unique-violation errors untouched', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.save.mockRejectedValue(new Error('connection reset'));

    await expect(service.createCategory({ name: 'Hair Care' })).rejects.toThrow('connection reset');
  });
});

describe('ContentService.updateCategory', () => {
  it('404s when the category does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.findOneBy.mockResolvedValue(null);

    await expect(service.updateCategory(9, { name: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.categoriesRepo.save).not.toHaveBeenCalled();
  });

  it('regenerates the slug from the new name when no slug is provided', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.findOneBy.mockResolvedValue({ id: 1, name: 'Hair Care', slug: 'hair-care-ab12' });

    await service.updateCategory(1, { name: 'Skin Care' });

    expect(mocks.categoriesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Skin Care', slug: expect.stringMatching(/^skin-care-[0-9a-f]{4}$/) }),
    );
  });

  it('keeps a pinned slug over regeneration', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.findOneBy.mockResolvedValue({ id: 1, name: 'Hair Care', slug: 'hair-care-ab12' });

    await service.updateCategory(1, { name: 'Skin Care', slug: 'skin' });

    expect(mocks.categoriesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Skin Care', slug: 'skin' }));
  });

  it('translates a duplicate 23505 on save into the Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.findOneBy.mockResolvedValue({ id: 1, name: 'Hair Care', slug: 'hair-care-ab12' });
    mocks.categoriesRepo.save.mockRejectedValue(pgError('23505'));

    await expect(service.updateCategory(1, { name: 'Skin Care' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'دسته‌بندی با این نام یا نامک از قبل وجود دارد',
    });
  });
});

describe('ContentService.deleteCategory', () => {
  it('deletes an unused category', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.delete.mockResolvedValue({ affected: 1 });

    await expect(service.deleteCategory(1)).resolves.toBeUndefined();
    expect(mocks.categoriesRepo.delete).toHaveBeenCalledWith({ id: 1 });
  });

  it('404s when nothing was deleted', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.delete.mockResolvedValue({ affected: 0 });

    await expect(service.deleteCategory(9)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('translates the FK restrict (23503) into the exact Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.delete.mockRejectedValue(pgError('23503'));

    await expect(service.deleteCategory(1)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این دسته‌بندی دارای مطلب است و قابل حذف نیست',
    });
  });
});

describe('ContentService.listCategories', () => {
  it('lists categories ordered by name', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.find.mockResolvedValue([{ id: 1, name: 'مو', slug: 'مو' }]);

    await expect(service.listCategories()).resolves.toEqual([{ id: 1, name: 'مو', slug: 'مو' }]);
    expect(mocks.categoriesRepo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
  });
});

describe('blog category DTOs', () => {
  it('CreateBlogCategoryDto requires a 1–60 char name', async () => {
    expect((await validate(plainToInstance(CreateBlogCategoryDto, {}))).map((e) => e.property)).toContain('name');
    expect(
      (await validate(plainToInstance(CreateBlogCategoryDto, { name: 'x'.repeat(61) }))).map((e) => e.property),
    ).toContain('name');
    await expect(validate(plainToInstance(CreateBlogCategoryDto, { name: 'مراقبت از مو' }))).resolves.toEqual([]);
  });

  it('category slug follows the slug pattern when provided', async () => {
    await expect(validate(plainToInstance(CreateBlogCategoryDto, { name: 'مو', slug: 'مراقبت-مو' }))).resolves.toEqual([]);
    const errors = await validate(plainToInstance(UpdateBlogCategoryDto, { slug: 'has space' }));
    expect(errors.map((e) => e.property)).toContain('slug');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gheychi/api test -- content.service`
Expected: FAIL — TS compile errors: `Module '"./dto/blog.dto"' has no exported member 'CreateBlogCategoryDto'`, and `Property 'createCategory' does not exist on type 'ContentService'` (likewise `updateCategory`, `deleteCategory`, `listCategories`).

- [ ] **Step 3: Add the category DTOs**

Append to the end of `apps/api/src/content/dto/blog.dto.ts`:

```typescript
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
```

- [ ] **Step 4: Implement the remaining service methods**

In `apps/api/src/content/content.service.ts`, the import block, module-scope constants, and constructor become:

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { isForeignKeyViolation, isUniqueViolation } from '../common/postgres-error-codes';
import { makeSlug } from '../common/slug.util';
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

// Exact message from the Plan 8 spec (§3.2) — surfaced as a toast by the admin panel.
const SLUG_CONFLICT = 'این نامک قبلاً استفاده شده است';
// name and slug are both UNIQUE on blog_categories; one 23505 message covers both.
const CATEGORY_CONFLICT = 'دسته‌بندی با این نام یا نامک از قبل وجود دارد';
// Exact message from the Plan 8 spec (§3.3) for the FK-restricted delete.
const CATEGORY_IN_USE = 'این دسته‌بندی دارای مطلب است و قابل حذف نیست';

@Injectable()
export class ContentService {
  constructor(
    @InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>,
    @InjectRepository(BlogCategory) private readonly categories: Repository<BlogCategory>,
  ) {}
```

Then append the new methods to the class, after `deletePost`:

```typescript
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
```

- [ ] **Step 5: Run the service test to verify it passes**

Run: `pnpm --filter @gheychi/api test -- content.service`
Expected: PASS (43 tests).

- [ ] **Step 6: Extend the audit-wiring spec (failing)**

In `apps/api/src/audit/audit-wiring.spec.ts`, the import block currently starts:

```typescript
import 'reflect-metadata';
import { AdminCategoriesController } from '../catalog/admin-categories.controller';
import { AdminConfigController } from '../platform-config/admin-config.controller';
```

becomes:

```typescript
import 'reflect-metadata';
import { AdminCategoriesController } from '../catalog/admin-categories.controller';
import { AdminBlogController } from '../content/admin-blog.controller';
import { AdminConfigController } from '../platform-config/admin-config.controller';
```

And the `cases` array currently ends:

```typescript
    {
      label: 'report resolve',
      handler: AdminReportsController.prototype.resolve,
      action: 'report.resolve',
      targetType: 'report',
    },
  ];
```

becomes:

```typescript
    {
      label: 'report resolve',
      handler: AdminReportsController.prototype.resolve,
      action: 'report.resolve',
      targetType: 'report',
    },
    {
      label: 'blog post create',
      handler: AdminBlogController.prototype.create,
      action: 'post.create',
      targetType: 'post',
    },
    {
      label: 'blog post update',
      handler: AdminBlogController.prototype.update,
      action: 'post.update',
      targetType: 'post',
    },
    {
      label: 'blog post publish',
      handler: AdminBlogController.prototype.publish,
      action: 'post.publish',
      targetType: 'post',
    },
    {
      label: 'blog post unpublish',
      handler: AdminBlogController.prototype.unpublish,
      action: 'post.unpublish',
      targetType: 'post',
    },
    {
      label: 'blog post delete',
      handler: AdminBlogController.prototype.remove,
      action: 'post.delete',
      targetType: 'post',
    },
    {
      label: 'blog category create',
      handler: AdminBlogController.prototype.createCategory,
      action: 'blogcategory.create',
      targetType: 'blogcategory',
    },
    {
      label: 'blog category update',
      handler: AdminBlogController.prototype.updateCategory,
      action: 'blogcategory.update',
      targetType: 'blogcategory',
    },
    {
      label: 'blog category delete',
      handler: AdminBlogController.prototype.removeCategory,
      action: 'blogcategory.delete',
      targetType: 'blogcategory',
    },
  ];
```

Run: `pnpm --filter @gheychi/api test -- audit-wiring`
Expected: FAIL — TS compile error, `Cannot find module '../content/admin-blog.controller'`.

- [ ] **Step 7: Write the controller**

Guards follow `AdminReportsController` (`AuthGuard, RolesGuard` + `@Roles('admin')` at class level). The two cover handlers (`POST`/`DELETE posts/:id/cover`) are deliberately absent — Task 6 adds them to this controller together with the storage seam and `FileInterceptor`.

```typescript
// apps/api/src/content/admin-blog.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ContentService } from './content.service';
import {
  AdminBlogPostQueryDto,
  CreateBlogCategoryDto,
  CreateBlogPostDto,
  UpdateBlogCategoryDto,
  UpdateBlogPostDto,
} from './dto/blog.dto';

@Controller('admin/blog')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminBlogController {
  constructor(private readonly content: ContentService) {}

  @Get('posts')
  list(@Query() query: AdminBlogPostQueryDto) {
    return this.content.listPostsForAdmin(query);
  }

  @Get('posts/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.getPostForAdmin(id);
  }

  @Post('posts')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.create', 'post')
  create(@Body() dto: CreateBlogPostDto) {
    return this.content.createPost(dto);
  }

  @Patch('posts/:id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.update', 'post')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBlogPostDto) {
    return this.content.updatePost(id, dto);
  }

  @Post('posts/:id/publish')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.publish', 'post')
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.publishPost(id);
  }

  @Post('posts/:id/unpublish')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.unpublish', 'post')
  unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.unpublishPost(id);
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.delete', 'post')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.deletePost(id);
  }

  @Post('categories')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('blogcategory.create', 'blogcategory')
  createCategory(@Body() dto: CreateBlogCategoryDto) {
    return this.content.createCategory(dto);
  }

  @Patch('categories/:id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('blogcategory.update', 'blogcategory')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBlogCategoryDto) {
    return this.content.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('blogcategory.delete', 'blogcategory')
  removeCategory(@Param('id', ParseIntPipe) id: number) {
    return this.content.deleteCategory(id);
  }
}
```

- [ ] **Step 8: Wire the controller and auth/audit modules into `ContentModule`**

`apps/api/src/content/content.module.ts` becomes (`AuthModule` supplies `AuthGuard`'s dependencies, `AuditModule` exports `AuditInterceptor`/`AuditService` — same import pair as `CatalogModule`/`ReportsModule`; note `AuditModule` itself imports `UsersModule`, not `AuthModule`, to avoid the documented module cycle — that constraint is `AuditModule`-internal and doesn't apply here):

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AdminBlogController } from './admin-blog.controller';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';

@Module({
  imports: [TypeOrmModule.forFeature([BlogPost, BlogCategory]), AuthModule, AuditModule],
  controllers: [AdminBlogController],
  providers: [ContentService],
})
export class ContentModule {}
```

- [ ] **Step 9: Run the audit-wiring test to verify it passes**

Run: `pnpm --filter @gheychi/api test -- audit-wiring`
Expected: PASS (34 tests — eight new cases × 2 assertions on top of the existing 18).

- [ ] **Step 10: Full unit suite + build**

Run: `pnpm --filter @gheychi/api test`
Expected: exit 0.

Run: `pnpm --filter @gheychi/api build`
Expected: exit 0 (catches any controller/module typing issue Jest's per-file compilation might miss).

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/content apps/api/src/audit/audit-wiring.spec.ts
git commit -m "feat(api): admin blog controller with categories, cover upload, and audit wiring"
```

### Task 6: Cover image upload/replace/delete via `StorageProvider`

**Files:**
- Modify: `apps/api/src/storage/storage.provider.ts` (add `publicUrl(key)` to the interface)
- Modify: `apps/api/src/storage/local-disk-storage.provider.ts` (implement `publicUrl`; `upload` delegates to it)
- Modify: `apps/api/src/storage/s3-storage.provider.ts` (same)
- Modify: `apps/api/src/storage/local-disk-storage.provider.spec.ts` (pin `publicUrl` = what `upload` returned)
- Modify: `apps/api/src/storage/s3-storage.provider.spec.ts` (same)
- Modify: `apps/api/src/content/content.service.ts` (Tasks 3–5's file — inject `STORAGE_PROVIDER`; add `setCover`/`clearCover`; extend `deletePost` with cover cleanup and `getPostForAdmin` with a derived `coverImageUrl`)
- Modify: `apps/api/src/content/content.service.spec.ts` (add the storage token to `setup()`'s providers — the constructor widens; see Step 8)
- Modify: `apps/api/src/content/content.module.ts` (import `StorageModule`)
- Modify: `apps/api/src/content/admin-blog.controller.ts` (Task 5's file — add the two cover handlers)
- Modify: `apps/api/src/audit/audit-wiring.spec.ts` (add the ninth case: `post.cover.set`)
- Test: `apps/api/src/content/content.service.cover.spec.ts`

Spec §3.3: `POST /api/admin/blog/posts/:id/cover` and `DELETE /api/admin/blog/posts/:id/cover`, mirroring `apps/api/src/salons/salon-photos.controller.ts` exactly — 5 MB `FileInterceptor` limit, `ParseFilePipeBuilder` magic-number sniffing (`image/jpeg|png|webp`, 422 on mismatch), server-controlled storage key (never `file.originalname`), replace deletes the old object **best-effort after** the row save, delete is best-effort too. Both handlers carry `@AuditAction('post.cover.set', 'post')` — same action string; the interceptor's payload (`req.body`: `{}` for the multipart POST, `null` for the DELETE) disambiguates.

One structural difference from salon photos: `blog_posts` stores only `cover_image_key` (Task 1's DDL has no URL column), so the public URL must be **derivable from the key at read time**. Salon photos persist the string `StorageProvider.upload()` returns; to expose the *identical* URL from a bare key, this task extracts that derivation into a new `publicUrl(key)` interface method and refactors both providers' `upload` to return `this.publicUrl(key)` — same derivation by construction, not by parallel string-building. (A repo-wide grep confirms the only `StorageProvider` implementers are the two providers; no test mocks the interface type, so adding a method breaks nothing else.) Task 7's public list/detail endpoints consume `publicUrl` for `coverImageUrl`.

Execution notes for files Tasks 3–5 created: **read `content.service.ts`, `content.module.ts`, `admin-blog.controller.ts`, and `content.service.spec.ts` before editing them.** The code below assumes Task 3–5's contract shapes (constructor `(posts, categories)` repos, controller field `this.content`); if the executed Task 4/5 named or ordered these differently, keep their names/order, append the storage parameter **last**, and adjust the new specs' positional arguments to match.

- [ ] **Step 1: Pin `publicUrl` in both storage provider specs (failing)**

In `apps/api/src/storage/local-disk-storage.provider.spec.ts`, add after the `'creates nested directories for the key as needed'` test:

```typescript
  it('derives the same public URL from a bare key that upload() returned for it', async () => {
    const uploaded = await provider.upload(Buffer.from('x'), 'blog/post-1/cover.jpg', 'image/jpeg');
    expect(provider.publicUrl('blog/post-1/cover.jpg')).toBe(uploaded);
    expect(provider.publicUrl('blog/post-1/cover.jpg')).toBe('http://localhost:3002/uploads/blog/post-1/cover.jpg');
  });
```

In `apps/api/src/storage/s3-storage.provider.spec.ts`, add after the `'deletes via DeleteObjectCommand'` test:

```typescript
  it('derives the same public URL from a bare key that upload() returned for it', () => {
    expect(provider.publicUrl('salons/abc/photo.jpg')).toBe('https://cdn.example.com/salons/abc/photo.jpg');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @gheychi/api test -- storage`
Expected: FAIL — both suites error at compile time (`Property 'publicUrl' does not exist on type 'LocalDiskStorageProvider'` / `'S3StorageProvider'`).

- [ ] **Step 3: Add `publicUrl` to the interface and both providers**

Replace `apps/api/src/storage/storage.provider.ts` with:

```typescript
export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

export interface StorageProvider {
  upload(buffer: Buffer, key: string, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
  /**
   * Derives the public URL for an already-stored key -- always the exact string
   * upload() returned for that key (upload delegates to this), so callers that
   * persist only the key (blog covers) expose the same URL as callers that
   * persist upload()'s return value (salon photos).
   */
  publicUrl(key: string): string;
}
```

In `apps/api/src/storage/local-disk-storage.provider.ts`, replace the `upload` method's return line and add the new method, so the class body reads:

```typescript
  async upload(buffer: Buffer, key: string, contentType?: string): Promise<string> {
    const filePath = join(this.root, key);
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return this.publicUrl(key);
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    await fs.rm(join(this.root, key), { force: true });
  }
```

In `apps/api/src/storage/s3-storage.provider.ts`, same treatment — `upload` ends with `return this.publicUrl(key);` and the class gains:

```typescript
  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }
```

- [ ] **Step 4: Run the storage suites to verify they pass**

Run: `pnpm --filter @gheychi/api test -- storage`
Expected: PASS — 5 tests in the local-disk suite, 3 in the S3 suite (the pre-existing upload-URL assertions double as regression proof that the refactor changed nothing).

- [ ] **Step 5: Write the failing cover-lifecycle unit spec**

```typescript
// apps/api/src/content/content.service.cover.spec.ts
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { StorageProvider } from '../storage/storage.provider';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';

const draftPost = () => ({
  id: 'post-1',
  title: 'راهنمای رنگ مو',
  slug: 'rahnama-rang-mo',
  excerpt: null,
  bodyMarkdown: '# متن مقاله',
  coverImageKey: null as string | null,
  categoryId: null,
  authorName: null,
  metaDescription: null,
  ogTitle: null,
  status: 'draft' as const,
  publishedAt: null,
  createdAt: new Date('2026-07-01T10:00:00.000Z'),
  updatedAt: new Date('2026-07-01T10:00:00.000Z'),
});

const jpeg = { buffer: Buffer.from('fake-image-bytes'), mimetype: 'image/jpeg' } as Express.Multer.File;

function makeService(overrides?: {
  posts?: Record<string, jest.Mock>;
  storage?: Record<string, jest.Mock>;
}) {
  const posts = {
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation(async (entity) => entity),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides?.posts,
  };
  const categories = {
    findOneBy: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
  };
  const storage = {
    upload: jest.fn().mockResolvedValue('http://localhost:3002/uploads/some-key'),
    delete: jest.fn().mockResolvedValue(undefined),
    publicUrl: jest.fn((key: string) => `http://localhost:3002/uploads/${key}`),
    ...overrides?.storage,
  };
  const service = new ContentService(
    posts as unknown as Repository<BlogPost>,
    categories as unknown as Repository<BlogCategory>,
    storage as unknown as StorageProvider,
  );
  return { service, posts, storage };
}

describe('ContentService.setCover', () => {
  it('404s for a missing post without touching storage', async () => {
    const { service, storage } = makeService();

    await expect(service.setCover('missing', jpeg)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('uploads under a server-controlled blog/<postId>/ key and persists it', async () => {
    const { service, posts, storage } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(draftPost()) },
    });

    const result = await service.setCover('post-1', jpeg);

    const key = storage.upload.mock.calls[0][1] as string;
    expect(key).toMatch(/^blog\/post-1\/[0-9a-f-]{36}\.jpg$/);
    expect(storage.upload).toHaveBeenCalledWith(jpeg.buffer, key, 'image/jpeg');
    expect(posts.save).toHaveBeenCalledWith(expect.objectContaining({ coverImageKey: key }));
    expect(result.coverImageUrl).toBe(`http://localhost:3002/uploads/${key}`);
    expect(storage.delete).not.toHaveBeenCalled(); // no previous cover to clean up
  });

  it('derives the extension from the validated mimetype, not the client filename', async () => {
    const { service, storage } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(draftPost()) },
    });
    const png = { buffer: Buffer.from('png-bytes'), mimetype: 'image/png' } as Express.Multer.File;

    await service.setCover('post-1', png);

    expect(storage.upload.mock.calls[0][1]).toMatch(/\.png$/);
  });

  it('replacing a cover deletes the old object only after the row is saved', async () => {
    const { service, posts, storage } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/old.jpg' }),
      },
    });

    await service.setCover('post-1', jpeg);

    expect(storage.delete).toHaveBeenCalledWith('blog/post-1/old.jpg');
    // Save-before-delete: a failed cleanup must never lose the new key.
    expect(posts.save.mock.invocationCallOrder[0]).toBeLessThan(storage.delete.mock.invocationCallOrder[0]);
  });

  it('tolerates a failing old-object delete (best-effort cleanup)', async () => {
    const { service } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/old.jpg' }),
      },
      storage: { delete: jest.fn().mockRejectedValue(new Error('storage down')) },
    });

    await expect(service.setCover('post-1', jpeg)).resolves.toMatchObject({
      coverImageKey: expect.stringMatching(/^blog\/post-1\//),
    });
  });
});

describe('ContentService.clearCover', () => {
  it('404s for a missing post', async () => {
    const { service } = makeService();

    await expect(service.clearCover('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clears the key, then deletes the object best-effort', async () => {
    const { service, posts, storage } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/old.jpg' }),
      },
    });

    await service.clearCover('post-1');

    expect(posts.save).toHaveBeenCalledWith(expect.objectContaining({ coverImageKey: null }));
    expect(storage.delete).toHaveBeenCalledWith('blog/post-1/old.jpg');
  });

  it('is a no-op when the post has no cover', async () => {
    const { service, posts, storage } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(draftPost()) },
    });

    await service.clearCover('post-1');

    expect(posts.save).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('tolerates a failing object delete', async () => {
    const { service, posts } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/old.jpg' }),
      },
      storage: { delete: jest.fn().mockRejectedValue(new Error('storage down')) },
    });

    await expect(service.clearCover('post-1')).resolves.toBeUndefined();
    expect(posts.save).toHaveBeenCalled();
  });
});

describe('ContentService.getPostForAdmin coverImageUrl', () => {
  it('attaches the derived public URL when a cover key exists (the admin editor consumes this)', async () => {
    const { service } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/cover.jpg' }),
      },
    });

    await expect(service.getPostForAdmin('post-1')).resolves.toMatchObject({
      coverImageUrl: 'http://localhost:3002/uploads/blog/post-1/cover.jpg',
    });
  });

  it('attaches coverImageUrl null when the post has no cover', async () => {
    const { service } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(draftPost()) },
    });

    await expect(service.getPostForAdmin('post-1')).resolves.toMatchObject({ coverImageUrl: null });
  });
});

describe('ContentService.deletePost cover cleanup', () => {
  it('deletes the cover object best-effort after removing the row', async () => {
    const { service, posts, storage } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/cover.jpg' }),
      },
    });

    await service.deletePost('post-1');

    expect(posts.delete).toHaveBeenCalledWith({ id: 'post-1' });
    expect(storage.delete).toHaveBeenCalledWith('blog/post-1/cover.jpg');
  });

  it('skips storage when the post never had a cover', async () => {
    const { service, storage } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(draftPost()) },
    });

    await service.deletePost('post-1');

    expect(storage.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Extend the audit wiring spec with the ninth Plan 8 case (failing)**

Task 5 brought `apps/api/src/audit/audit-wiring.spec.ts` to 34 tests with its eight cases (`post.create/update/publish/unpublish/delete`, `blogcategory.create/update/delete`) and already imports `AdminBlogController`. Add the ninth case — the contract's `post.cover.set` — to the `cases` array after Task 5's `blogcategory delete` entry (the last one):

```typescript
    {
      label: 'blog post cover set',
      handler: AdminBlogController.prototype.uploadCover,
      action: 'post.cover.set',
      targetType: 'post',
    },
```

(The `removeCover` handler carries the same action string by design — spec §3.3 — so one wiring case per action keeps the file at the contract's 36 tests; the DELETE handler's decorators are exercised by the lifecycle e2e in the plan's e2e task.)

- [ ] **Step 7: Run both new suites to verify they fail**

Run: `pnpm --filter @gheychi/api test -- content.service.cover`
Expected: FAIL — compile error: `ContentService` has no `setCover`/`clearCover`, and its constructor takes two arguments, not three.

Run: `pnpm --filter @gheychi/api test -- audit-wiring`
Expected: FAIL — the two new tests error (`AdminBlogController.prototype.uploadCover` is `undefined` / TS: property `uploadCover` does not exist); the 34 existing tests still pass.

- [ ] **Step 8: Inject storage into `ContentService` and add the cover methods**

Read Task 4/5's `apps/api/src/content/content.service.ts` first. Add to its imports:

```typescript
import { randomUUID } from 'crypto';
import { Inject } from '@nestjs/common'; // merge into the existing @nestjs/common import line
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
```

Add above the class (module scope, mirroring `salon-photos.controller.ts`):

```typescript
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
```

Append the storage parameter **last** in the constructor, so it reads:

```typescript
  constructor(
    @InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>,
    @InjectRepository(BlogCategory) private readonly categories: Repository<BlogCategory>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}
```

Add the two methods after `deletePost`:

```typescript
  async setCover(id: string, file: Express.Multer.File): Promise<BlogPost & { coverImageUrl: string }> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException();
    // Deliberately NOT using file.originalname in the key -- it's client-controlled and
    // could contain path-traversal sequences. The mimetype was already restricted to
    // image/jpeg|png|webp by the controller's validator, so deriving the extension from
    // it keeps the key fully server-controlled (same reasoning as salon photo uploads).
    const extension = EXTENSION_BY_MIME_TYPE[file.mimetype] ?? 'bin';
    const key = `blog/${id}/${randomUUID()}.${extension}`;
    await this.storage.upload(file.buffer, key, file.mimetype);
    const oldKey = post.coverImageKey;
    post.coverImageKey = key;
    const saved = await this.posts.save(post);
    // Best-effort replace-cleanup AFTER the save: the DB row is the source of truth for
    // the cover; an orphaned object after a failed delete is a harmless cleanup gap
    // (same class of tradeoff as salon photo deletes).
    if (oldKey) {
      await this.storage.delete(oldKey).catch(() => {});
    }
    return { ...saved, coverImageUrl: this.storage.publicUrl(key) };
  }

  async clearCover(id: string): Promise<void> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException();
    const oldKey = post.coverImageKey;
    if (!oldKey) return; // idempotent: nothing to clear
    post.coverImageKey = null;
    await this.posts.save(post);
    await this.storage.delete(oldKey).catch(() => {});
  }
```

Replace Task 3's `getPostForAdmin` with a version that attaches the derived URL — the admin editor's `GET /admin/blog/posts/:id` reload after a cover upload consumes this, and it is the same field name the public queries (Task 7) expose:

```typescript
  async getPostForAdmin(id: string): Promise<BlogPost & { coverImageUrl: string | null }> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    return { ...post, coverImageUrl: post.coverImageKey ? this.storage.publicUrl(post.coverImageKey) : null };
  }
```

Replace `deletePost` with (same 404-on-miss + hard-delete semantics as Task 4's version, now with the spec §3.3 best-effort cover cleanup — the storage seam didn't exist before this task, which is why Task 4 deliberately left it out):

```typescript
  async deletePost(id: string): Promise<void> {
    const post = await this.posts.findOneBy({ id });
    if (!post) throw new NotFoundException('Post not found');
    // Hard delete for any status (spec §3.3) — unpublish is the soft path.
    await this.posts.delete({ id });
    // Best-effort object cleanup after the row delete: the DB row is the source of
    // truth for what's public; an orphaned object after a storage failure is a
    // harmless cleanup gap (same tradeoff as SalonPhotosController.remove()).
    if (post.coverImageKey) {
      await this.storage.delete(post.coverImageKey).catch(() => {});
    }
  }
```

Tasks 3–5's `content.service.spec.ts` builds the service through `Test.createTestingModule` with only the two repository providers, so the widened constructor no longer resolves there. Add the storage token to its `setup()` providers — no existing test in that file asserts on storage (`deletePost`'s cases only exercise posts without a cover, and `getPostForAdmin`'s cases use `toMatchObject`, which ignores the new field):

```typescript
import { STORAGE_PROVIDER } from '../storage/storage.provider'; // new import in content.service.spec.ts

// in setup()'s providers array, after the BlogCategory repository entry:
      { provide: STORAGE_PROVIDER, useValue: { upload: jest.fn(), delete: jest.fn(), publicUrl: jest.fn() } },
```

- [ ] **Step 9: Import `StorageModule` into the content module**

Read `apps/api/src/content/content.module.ts` first, then add:

```typescript
import { StorageModule } from '../storage/storage.module';
```

and append `StorageModule` to the `imports` array, so it reads (Task 5's version plus the new entry):

```typescript
  imports: [TypeOrmModule.forFeature([BlogPost, BlogCategory]), AuditModule, StorageModule],
```

- [ ] **Step 10: Add the two cover handlers to the admin controller**

Read Task 5's `apps/api/src/content/admin-blog.controller.ts` first. Add its first file-upload imports (Task 5's controller has none — merge the three `@nestjs/common` symbols into its existing import line; the `FileInterceptor` line is new):

```typescript
import { HttpStatus, ParseFilePipeBuilder, UploadedFile } from '@nestjs/common'; // merge into the existing import line
import { FileInterceptor } from '@nestjs/platform-express';
```

Add after the `remove` (post delete) handler, keeping Task 5's receiver name for `ContentService` (shown here as `this.content` — adjust if Task 5 named the field differently):

```typescript
  @Post('posts/:id/cover')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }), AuditInterceptor)
  @AuditAction('post.cover.set', 'post')
  uploadCover(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        // Real magic-number content-sniffing (via the `file-type` package), with no
        // mimetype-trusting fallback -- identical validator to salon photo uploads:
        // only actual file bytes matching a real image signature pass (422 otherwise).
        .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    return this.content.setCover(id, file);
  }

  @Delete('posts/:id/cover')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.cover.set', 'post')
  removeCover(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.clearCover(id);
  }
```

(Route shapes `posts/:id/cover` don't collide with Task 5's `posts/:id`, `posts/:id/publish`, `posts/:id/unpublish` routes on the `admin/blog` controller. `AuditInterceptor` sits alongside `FileInterceptor` in the same `@UseInterceptors` call — the wiring spec's `toContain` assertion handles the mixed array.)

- [ ] **Step 11: Run the suites to verify they pass**

Run: `pnpm --filter @gheychi/api test -- content.service.cover`
Expected: PASS (13 tests)

Run: `pnpm --filter @gheychi/api test -- audit-wiring`
Expected: PASS (36 tests — the contract's 18 original + 18 Plan 8 additions)

Run: `pnpm --filter @gheychi/api test`
Expected: PASS — full suite, including Task 4/5's content specs against the widened constructor.

Run: `pnpm --filter @gheychi/api build`
Expected: exit 0 (catches cross-file type breaks ts-jest's per-file transform can miss).

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/storage/storage.provider.ts apps/api/src/storage/local-disk-storage.provider.ts apps/api/src/storage/local-disk-storage.provider.spec.ts apps/api/src/storage/s3-storage.provider.ts apps/api/src/storage/s3-storage.provider.spec.ts apps/api/src/content/content.service.ts apps/api/src/content/content.service.spec.ts apps/api/src/content/content.service.cover.spec.ts apps/api/src/content/content.module.ts apps/api/src/content/admin-blog.controller.ts apps/api/src/audit/audit-wiring.spec.ts
git commit -m "feat(api): blog post cover upload/replace/delete via StorageProvider with audit capture"
```

---

### Task 7: Public blog surface — list, by-slug, categories, sitemap source

**Files:**
- Create: `apps/api/src/content/blog.controller.ts`
- Create: `apps/api/src/content/sitemap-blog.controller.ts`
- Modify: `apps/api/src/content/content.service.ts` (add `listPublishedPosts`, `getPublishedBySlug`)
- Modify: `apps/api/src/content/dto/blog.dto.ts` (add `PublicBlogPostsQueryDto`)
- Modify: `apps/api/src/content/content.module.ts` (register the two controllers)
- Test: `apps/api/src/content/content.service.public.spec.ts`
- Test: `apps/api/src/content/sitemap-blog.controller.spec.ts`

Spec §3.4/§3.5: three unauthenticated endpoints — `GET /api/blog/posts` (published only, `published_at DESC`, `{items,total,page,pageSize}` envelope, optional `category=<slug>` filter, list items carry exactly `id,title,slug,excerpt,coverImageUrl,categoryName,categorySlug,authorName,publishedAt` and **no `bodyMarkdown`**), `GET /api/blog/posts/:slug` (published only, 404 otherwise, full post incl. `bodyMarkdown` and SEO fields), `GET /api/blog/categories` (delegates to Task 5's `listCategories` — no new service method) — plus `GET /api/sitemap/blog-posts`, mirroring `apps/api/src/salons/sitemap-salons.controller.ts` (a second thin `@Controller('sitemap')` class; Nest merges same-prefix controllers) but returning `{slug, updatedAt}` objects instead of bare slugs so the sitemap can set `lastmod` from `updated_at`.

`coverImageUrl` comes from Task 6's `storage.publicUrl(coverImageKey)` — the same derivation salon photos persist at upload time. Category name/slug join uses the second-IN-lookup idiom from `AuditService.listForAdmin` (entities carry no relation decorators by repo convention). **The user-app half of the sitemap — a `server/api/__sitemap__/blog-urls.ts` nitro route mapping `updatedAt` → `lastmod` plus the `nuxt.config.ts` `sitemap.sources` entry, mirroring `server/api/__sitemap__/urls.ts` — belongs to the user-app blog task, not this one.** Read Tasks 3–6's `content.service.ts`, `content.module.ts`, and `dto/blog.dto.ts` before editing.

- [ ] **Step 1: Write the failing public-query unit spec**

```typescript
// apps/api/src/content/content.service.public.spec.ts
import { NotFoundException } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { StorageProvider } from '../storage/storage.provider';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';

const publishedPost = () => ({
  id: 'post-1',
  title: 'راهنمای رنگ مو',
  slug: 'rahnama-rang-mo',
  excerpt: 'خلاصه مقاله',
  bodyMarkdown: '# متن کامل مقاله',
  coverImageKey: 'blog/post-1/cover.jpg' as string | null,
  categoryId: 7 as number | null,
  authorName: 'تیم آرایشگاه',
  metaDescription: 'توضیح متا',
  ogTitle: 'عنوان اشتراک‌گذاری',
  status: 'published' as const,
  publishedAt: new Date('2026-07-09T10:00:00.000Z'),
  createdAt: new Date('2026-07-01T10:00:00.000Z'),
  updatedAt: new Date('2026-07-09T10:00:00.000Z'),
});

function makeService(overrides?: {
  posts?: Record<string, jest.Mock>;
  categories?: Record<string, jest.Mock>;
}) {
  const posts = {
    findOneBy: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    ...overrides?.posts,
  };
  const categories = {
    findOneBy: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    ...overrides?.categories,
  };
  const storage = {
    upload: jest.fn(),
    delete: jest.fn(),
    publicUrl: jest.fn((key: string) => `http://localhost:3002/uploads/${key}`),
  };
  const service = new ContentService(
    posts as unknown as Repository<BlogPost>,
    categories as unknown as Repository<BlogCategory>,
    storage as unknown as StorageProvider,
  );
  return { service, posts, categories };
}

describe('ContentService.listPublishedPosts', () => {
  it('queries published-only, newest published first, with default paging', async () => {
    const { service, posts } = makeService();

    const result = await service.listPublishedPosts({});

    expect(posts.findAndCount).toHaveBeenCalledWith({
      where: { status: 'published' },
      order: { publishedAt: 'DESC' },
      skip: 0,
      take: 20,
    });
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('maps items to the public shape: derived coverImageUrl, joined category, no bodyMarkdown', async () => {
    const { service, categories } = makeService({
      posts: { findAndCount: jest.fn().mockResolvedValue([[publishedPost()], 1]) },
      categories: { find: jest.fn().mockResolvedValue([{ id: 7, name: 'رنگ مو', slug: 'rang-mo' }]) },
    });

    const result = await service.listPublishedPosts({});

    expect(categories.find).toHaveBeenCalledWith({ where: { id: In([7]) } });
    expect(result.items[0]).toEqual({
      id: 'post-1',
      title: 'راهنمای رنگ مو',
      slug: 'rahnama-rang-mo',
      excerpt: 'خلاصه مقاله',
      coverImageUrl: 'http://localhost:3002/uploads/blog/post-1/cover.jpg',
      categoryName: 'رنگ مو',
      categorySlug: 'rang-mo',
      authorName: 'تیم آرایشگاه',
      publishedAt: new Date('2026-07-09T10:00:00.000Z'),
    });
    expect(result.items[0]).not.toHaveProperty('bodyMarkdown');
  });

  it('returns null cover/category fields for posts without them, skipping the category lookup', async () => {
    const { service, categories } = makeService({
      posts: {
        findAndCount: jest
          .fn()
          .mockResolvedValue([[{ ...publishedPost(), coverImageKey: null, categoryId: null }], 1]),
      },
    });

    const result = await service.listPublishedPosts({});

    expect(categories.find).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({ coverImageUrl: null, categoryName: null, categorySlug: null });
  });

  it('resolves a category slug filter to its id and applies explicit paging', async () => {
    const { service, posts, categories } = makeService({
      categories: { findOneBy: jest.fn().mockResolvedValue({ id: 7, name: 'رنگ مو', slug: 'rang-mo' }) },
    });

    await service.listPublishedPosts({ category: 'rang-mo', page: 2, pageSize: 10 });

    expect(categories.findOneBy).toHaveBeenCalledWith({ slug: 'rang-mo' });
    expect(posts.findAndCount).toHaveBeenCalledWith({
      where: { status: 'published', categoryId: 7 },
      order: { publishedAt: 'DESC' },
      skip: 10,
      take: 10,
    });
  });

  it('short-circuits an unknown category slug to an empty envelope', async () => {
    const { service, posts } = makeService();

    const result = await service.listPublishedPosts({ category: 'na-mojood' });

    expect(posts.findAndCount).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });
});

describe('ContentService.getPublishedBySlug', () => {
  it('looks up by slug AND published status, returning the full post with derived fields', async () => {
    const { service, posts } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(publishedPost()) },
      categories: { findOneBy: jest.fn().mockResolvedValue({ id: 7, name: 'رنگ مو', slug: 'rang-mo' }) },
    });

    const result = await service.getPublishedBySlug('rahnama-rang-mo');

    expect(posts.findOneBy).toHaveBeenCalledWith({ slug: 'rahnama-rang-mo', status: 'published' });
    expect(result).toMatchObject({
      bodyMarkdown: '# متن کامل مقاله',
      metaDescription: 'توضیح متا',
      ogTitle: 'عنوان اشتراک‌گذاری',
      coverImageUrl: 'http://localhost:3002/uploads/blog/post-1/cover.jpg',
      categoryName: 'رنگ مو',
      categorySlug: 'rang-mo',
    });
  });

  it('404s for missing and draft slugs alike (status is part of the lookup key)', async () => {
    const { service } = makeService();

    await expect(service.getPublishedBySlug('pish-nevis')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Write the failing sitemap controller spec**

```typescript
// apps/api/src/content/sitemap-blog.controller.spec.ts
import { Repository } from 'typeorm';
import { BlogPost } from './blog-post.entity';
import { SitemapBlogController } from './sitemap-blog.controller';

describe('SitemapBlogController', () => {
  it('emits only published posts as {slug, updatedAt} (updatedAt feeds lastmod)', async () => {
    const rows = [{ slug: 'rahnama-rang-mo', updatedAt: new Date('2026-07-09T10:00:00.000Z') }];
    const posts = { find: jest.fn().mockResolvedValue(rows) };
    const controller = new SitemapBlogController(posts as unknown as Repository<BlogPost>);

    const result = await controller.list();

    expect(posts.find).toHaveBeenCalledWith({
      where: { status: 'published' },
      select: ['slug', 'updatedAt'],
      order: { publishedAt: 'DESC' },
    });
    expect(result).toEqual([{ slug: 'rahnama-rang-mo', updatedAt: new Date('2026-07-09T10:00:00.000Z') }]);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @gheychi/api test -- content.service.public`
Expected: FAIL — compile error: `ContentService` has no `listPublishedPosts`/`getPublishedBySlug`.

Run: `pnpm --filter @gheychi/api test -- sitemap-blog`
Expected: FAIL — cannot resolve `./sitemap-blog.controller` (file doesn't exist).

- [ ] **Step 4: Add the public query DTO**

Read `apps/api/src/content/dto/blog.dto.ts` first, then append (merge any of `Type`/`IsInt`/`IsOptional`/`IsString`/`Max`/`Min` into the existing `class-transformer`/`class-validator` import lines — Task 5's admin query DTO already imports most of them):

```typescript
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
```

- [ ] **Step 5: Add the two public query methods to `ContentService`**

In `apps/api/src/content/content.service.ts`, ensure `In` is included in the `typeorm` import line, add the exported item type above the class:

```typescript
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
```

and add after Task 6's `clearCover`:

```typescript
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
```

- [ ] **Step 6: Create the public controllers**

```typescript
// apps/api/src/content/blog.controller.ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ContentService } from './content.service';
import { PublicBlogPostsQueryDto } from './dto/blog.dto';

/** Public, unauthenticated blog surface (spec §3.4) -- published content only. */
@Controller('blog')
export class BlogController {
  constructor(private readonly content: ContentService) {}

  @Get('posts')
  list(@Query() query: PublicBlogPostsQueryDto) {
    return this.content.listPublishedPosts(query);
  }

  @Get('posts/:slug')
  bySlug(@Param('slug') slug: string) {
    return this.content.getPublishedBySlug(slug);
  }

  @Get('categories')
  categories() {
    return this.content.listCategories();
  }
}
```

```typescript
// apps/api/src/content/sitemap-blog.controller.ts
import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlogPost } from './blog-post.entity';

/**
 * Sitemap source for /blog/<slug>, mirroring SitemapSalonsController. Unlike the
 * salons source (bare slugs), each entry carries updatedAt so the user-app's
 * sitemap route can emit lastmod (spec §3.5).
 */
@Controller('sitemap')
export class SitemapBlogController {
  constructor(@InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>) {}

  @Get('blog-posts')
  async list(): Promise<Array<{ slug: string; updatedAt: Date }>> {
    const rows = await this.posts.find({
      where: { status: 'published' },
      select: ['slug', 'updatedAt'],
      order: { publishedAt: 'DESC' },
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt }));
  }
}
```

- [ ] **Step 7: Register the controllers in the content module**

In `apps/api/src/content/content.module.ts`, add the imports:

```typescript
import { BlogController } from './blog.controller';
import { SitemapBlogController } from './sitemap-blog.controller';
```

and extend the `controllers` array, so it reads:

```typescript
  controllers: [AdminBlogController, BlogController, SitemapBlogController],
```

- [ ] **Step 8: Run the suites to verify they pass**

Run: `pnpm --filter @gheychi/api test -- content.service.public`
Expected: PASS (7 tests)

Run: `pnpm --filter @gheychi/api test -- sitemap-blog`
Expected: PASS (1 test)

Run: `pnpm --filter @gheychi/api test`
Expected: PASS — full suite.

Run: `pnpm --filter @gheychi/api build`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/content/blog.controller.ts apps/api/src/content/sitemap-blog.controller.ts apps/api/src/content/sitemap-blog.controller.spec.ts apps/api/src/content/content.service.ts apps/api/src/content/content.service.public.spec.ts apps/api/src/content/dto/blog.dto.ts apps/api/src/content/content.module.ts
git commit -m "feat(api): public blog endpoints (published-only list/by-slug/categories) + blog sitemap source"
```

### Task 8: Blog CMS lifecycle e2e — draft → publish → public surface → sitemap → audit trail

**Files:**
- Test: `apps/api/test/blog.e2e-spec.ts`

Exercises the whole content module against real Postgres, per spec §6: an admin creates a category and a draft (which stays entirely off the public surface — list, by-slug, and sitemap), publishes it, and the public contract fields appear (camelCase, joined category fields, `coverImageUrl` after a real multipart upload — then replaced with a second upload and finally deleted, nulling it again); by-slug returns `bodyMarkdown`; the post enters the sitemap; unpublish → republish proves `published_at` is stamped only once; final unpublish removes the post from every public surface; category delete is restricted (Farsi 409 asserted verbatim) until the post is deleted; and the audit trail is verified in **one direct `audit_log` query with no polling** — safe because the `AuditInterceptor` awaits its insert on both the success and failure paths before the HTTP response goes out (see the class comment in `src/audit/audit.interceptor.ts`), and `resetDatabase()` gives this file a fresh schema in which it is the sole writer (same invariant `test/reports.e2e-spec.ts` leans on for its notification count).

This is a verification task over Tasks 1–7 — it adds **no implementation**, so (like Plan 7's Task 7) there is no failing-test-first step: the spec is written once and expected to pass first run, with each failure mode pointing at a specific earlier task's wiring.

Harness conventions follow `test/reports.e2e-spec.ts`: `resetDatabase()` (drops the schema and re-runs all migrations, including Task 1's `1752600000000-blog-cms.ts`) + `createTestApp()` + `loginAs`/`loginAsAdmin` from `test/utils/auth-helper.ts`, and `app.get(DataSource)` for direct SQL assertions.

Conventions this spec pins deliberately:
- **Action POSTs return 201** (`/publish`, `/unpublish`, `/cover`) — Nest's default for `@Post()`; no existing action endpoint in this repo overrides it with `@HttpCode`.
- **Sitemap route**: `GET /api/sitemap/blog-posts` returning `Array<{ slug, updatedAt }>` — the blog mirror of `GET /api/sitemap/salon-slugs` (`src/salons/sitemap-salons.controller.ts`) extended with `updatedAt` (which the user-app's sitemap route maps to `lastmod`) per spec §3.5. It's a single top-of-file const; if the Task 7 controller landed under a different path, align the const, not twelve call sites.
- **`coverImageUrl` contains `/uploads/`** — the test env uses `LocalDiskStorageProvider` (`STORAGE_PROVIDER` unset → local disk, `src/storage/storage.module.ts`), whose URLs are `${APP_BASE_URL}/uploads/${key}`; this is the exact assertion `test/salon-photos.e2e-spec.ts` makes.
- **Latin titles/names** so slugs come from `makeSlug`'s normal path — the util strips non-`[a-z0-9]`, so Persian input falls through to the random fallback and nothing about the slug would be assertable. The post slug is then PATCHed to a fully deterministic value (which also exercises "slug editable via PATCH", spec §3.2).
- The lifecycle deliberately exercises **all nine audit action strings** (the two lost-race 409s and the restrict-delete 409 additionally prove the interceptor's `success: false` path end to end).

Prerequisite: docker services up (`docker compose up -d`).

- [ ] **Step 1: Write the e2e spec**

```typescript
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
        authorName: 'تیم آرایشگاه',
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
    expect(sitemap.body).toEqual([]);

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
      .expect(201);

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
      authorName: 'تیم آرایشگاه',
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

  it('returns the full article by slug, body and SEO fields included', async () => {
    const res = await request(app.getHttpServer()).get(`/api/blog/posts/${postSlug}`).expect(200);
    expect(res.body.title).toBe('Best Hair Salons in Tehran');
    expect(res.body.bodyMarkdown).toBe(BODY_MARKDOWN);
    expect(res.body.metaDescription).toBe('توضیح متا برای سئو');
    expect(res.body.ogTitle).toBe('عنوان اشتراک‌گذاری بلاگ');
    expect(res.body.authorName).toBe('تیم آرایشگاه');
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
    expect(res.body).toHaveLength(1);
    expect(res.body[0].slug).toBe(postSlug);
    expect(Number.isNaN(new Date(res.body[0].updatedAt).getTime())).toBe(false);
  });

  it('keeps the original published_at across unpublish → republish', async () => {
    await request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/unpublish`)
      .set('Cookie', adminCookie)
      .expect(201);
    await request(app.getHttpServer()).get(`/api/blog/posts/${postSlug}`).expect(404);

    await request(app.getHttpServer())
      .post(`/api/admin/blog/posts/${postId}/publish`)
      .set('Cookie', adminCookie)
      .expect(201);

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
      .expect(201);

    const list = await request(app.getHttpServer()).get('/api/blog/posts').expect(200);
    expect(list.body.total).toBe(0);
    await request(app.getHttpServer()).get(`/api/blog/posts/${postSlug}`).expect(404);
    const sitemap = await request(app.getHttpServer()).get(SITEMAP_BLOG_PATH).expect(200);
    expect(sitemap.body).toEqual([]);

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
        'post.cover.set|true', // first cover upload
        'post.cover.set|true', // cover replace (second upload)
        'post.cover.set|true', // cover delete — the DELETE handler carries the same action string (spec §3.3)
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
```

- [ ] **Step 2: Run the blog e2e spec**

Run: `pnpm --filter @gheychi/api test:e2e -- blog`
Expected: PASS (15 tests). This is a verification task over Tasks 1–7 (no new implementation), so it should pass first run. If anything fails, it points at a wiring gap in an earlier task:
- `relation "blog_posts" does not exist` → Task 1's migration isn't in `src/migrations/` (or its filename timestamp is wrong, so `resetDatabase()` never ran it).
- A DI error at boot → `ContentModule` is missing its `AuditModule` import, or a repository token wasn't registered via `TypeOrmModule.forFeature`.
- A 404 on `SITEMAP_BLOG_PATH` → the const at the top of this file disagrees with the route in `src/content/sitemap-blog.controller.ts`; align the const (one place) with the controller, not the other way round — the controller's path is also what the user-app sitemap source (nuxt.config task) points at.
- A missing or `success`-mismatched row in the final multiset → that handler's `@UseInterceptors(AuditInterceptor)` / `@AuditAction(...)` pair didn't get applied, or its action string drifted from the nine contract values.
- A Farsi-message mismatch on the 409s → the `ConflictException` text in `ContentService` drifted from the spec strings.

- [ ] **Step 3: Run the full backend e2e suite**

Run: `pnpm --filter @gheychi/api test:e2e`
Expected: PASS — every suite, including all pre-existing ones. The `test:e2e` script already passes `--runInBand`, and each spec file calls `resetDatabase()` in its own `beforeAll`, so the fresh-schema sole-writer invariant holds file by file; a failure in a *pre-existing* suite here means this plan's earlier tasks changed shared behavior (slug util move, module wiring) rather than anything in this task.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/blog.e2e-spec.ts
git commit -m "test(api): blog CMS lifecycle e2e — draft/publish/sitemap/cover/audit trail"
```

### Task 9: Admin-panel markdown renderer, blog label maps, and the `newspaper` icon

**Files:**
- Modify: `apps/admin-panel/package.json` (:14-26 dependencies, :27-40 devDependencies — add `markdown-it` + `@types/markdown-it`)
- Create: `apps/admin-panel/src/utils/markdown.ts`
- Test: `apps/admin-panel/src/utils/markdown.spec.ts` (create)
- Modify: `apps/admin-panel/src/utils/labels.ts` (:57-59 after `genderTargetLabel`; :62-72 `AUDIT_ACTION` map; :78-85 `AUDIT_TARGET_TYPE` map)
- Test: `apps/admin-panel/src/utils/labels.spec.ts` (modify — guard 9 → 18, new `blogPostStatusLabel` block)
- Modify: `apps/admin-panel/src/components/ui/AppIcon.vue` (:7-13 Lucide imports, :15-20 `IconName` union, :22-59 `ICONS` map)

Three pieces of pure admin-panel plumbing the blog pages (Tasks 10–11) sit on. `renderMarkdown` is the app's single markdown-it instance — `html: false` is its security boundary, pinned by an invariant test so a config regression fails CI (design doc §8). Note the sanctioned-`v-html` comment from the shared contract belongs at the two *binding* sites (the editor preview in the next admin task, the user-app article body in its own task), not in this utility — this task only ships the renderer and its proof. The label maps extend Plan 7's `labels.ts` exactly the way Plan 7's length-guard test was designed to force: `AUDIT_ACTION_KEYS` grows 9 → 18, so the guard must be deliberately updated here. `AuditLogView`'s filter dropdown derives from `AUDIT_ACTION_KEYS` and needs no change — it picks up the nine new actions automatically.

- [ ] **Step 1: Write the failing markdown-renderer invariant test**

```typescript
// apps/admin-panel/src/utils/markdown.spec.ts
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  // Invariant pinning the html:false config: raw HTML in the Markdown source must come
  // out as escaped text, never live markup. The editor preview binds this output with
  // v-html on the strength of these two tests -- do not weaken them.
  it('escapes a raw <script> tag instead of parsing it', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('keeps a raw <img onerror> payload inert', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('still renders actual Markdown', () => {
    const out = renderMarkdown('# عنوان\n\nمتن **مهم**')
    expect(out).toContain('<h1>عنوان</h1>')
    expect(out).toContain('<strong>مهم</strong>')
  })

  it('linkifies bare URLs', () => {
    expect(renderMarkdown('آدرس: https://example.com')).toContain('<a href="https://example.com">')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run (from repo root): `pnpm --filter @gheychi/admin-panel test -- src/utils/markdown.spec.ts`
Expected: FAIL — `Failed to resolve import "./markdown"` (the utility does not exist yet).

- [ ] **Step 3: Add the markdown-it dependency and implement the renderer**

In `apps/admin-panel/package.json`, add `"markdown-it": "^14.1.0"` to `dependencies` (after `jalaali-js`) and `"@types/markdown-it": "^14.1.2"` to `devDependencies` (after `@playwright/test`):

```json
  "dependencies": {
    "@fontsource-variable/vazirmatn": "^5.2.8",
    "@lucide/vue": "^1.23.0",
    "@tailwindcss/vite": "^4.3.2",
    "echarts": "^6.1.0",
    "jalaali-js": "^2.0.0",
    "markdown-it": "^14.1.0",
    "pinia": "^3.0.4",
    "tailwindcss": "^4.3.2",
    "vue": "^3.5.13",
    "vue-echarts": "^8.0.1",
    "vue-multiselect": "^3.5.0",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.1",
    "@types/markdown-it": "^14.1.2",
    "@types/node": "^22.10.0",
```

(the rest of `devDependencies` is unchanged). Then run `pnpm install` from the repo root and confirm exit code 0.

Create `apps/admin-panel/src/utils/markdown.ts`:

```typescript
// apps/admin-panel/src/utils/markdown.ts
// html:false is THE security boundary for the blog editor preview: raw HTML in the
// Markdown source is escaped, never parsed, so the preview may bind the output with
// v-html. Pinned by markdown.spec.ts -- never enable html here.
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true })

export function renderMarkdown(src: string): string {
  return md.render(src)
}
```

- [ ] **Step 4: Run the markdown test to verify it passes**

Run: `pnpm --filter @gheychi/admin-panel test -- src/utils/markdown.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Update the labels test — guard to 18 and the new status getter**

Replace `apps/admin-panel/src/utils/labels.spec.ts` in full (the `auditActionLabel` describe gains the 18-count, `blogPostStatusLabel` is new, `reportStatusLabel` is unchanged):

```typescript
// apps/admin-panel/src/utils/labels.spec.ts
import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION_KEYS, auditActionLabel, blogPostStatusLabel, reportStatusLabel } from './labels'

describe('auditActionLabel', () => {
  it('maps every one of the eighteen audited actions to a Farsi label', () => {
    // 9 from Plan 7 + 6 post.* + 3 blogcategory.* from Plan 8. This length guard is
    // deliberate: adding a backend @AuditAction without a Farsi label must fail here.
    expect(AUDIT_ACTION_KEYS).toHaveLength(18)
    for (const action of AUDIT_ACTION_KEYS) {
      const entry = auditActionLabel(action)
      // A mapped entry never falls back to the raw dotted action name.
      expect(entry.label).not.toBe(action)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })

  it('falls back to the raw value with a neutral tone for unknown actions', () => {
    expect(auditActionLabel('something.new')).toEqual({ label: 'something.new', tone: 'neutral' })
  })
})

describe('blogPostStatusLabel', () => {
  it('maps the two blog post statuses', () => {
    expect(blogPostStatusLabel('draft')).toEqual({ label: 'پیش‌نویس', tone: 'neutral' })
    expect(blogPostStatusLabel('published')).toEqual({ label: 'منتشرشده', tone: 'success' })
  })

  it('falls back to the raw value for unknown statuses', () => {
    expect(blogPostStatusLabel('archived')).toEqual({ label: 'archived', tone: 'neutral' })
  })
})

describe('reportStatusLabel', () => {
  it('maps the three report statuses', () => {
    expect(reportStatusLabel('open')).toEqual({ label: 'باز', tone: 'warning' })
    expect(reportStatusLabel('resolved')).toEqual({ label: 'رسیدگی شده', tone: 'success' })
    expect(reportStatusLabel('dismissed')).toEqual({ label: 'رد شده', tone: 'neutral' })
  })

  it('falls back to the raw value for unknown statuses', () => {
    expect(reportStatusLabel('weird')).toEqual({ label: 'weird', tone: 'neutral' })
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @gheychi/admin-panel test -- src/utils/labels.spec.ts`
Expected: FAIL — `labels.ts` has no export named `blogPostStatusLabel` (and `AUDIT_ACTION_KEYS` is still length 9).

- [ ] **Step 7: Add the blog maps to `labels.ts`**

Three edits in `apps/admin-panel/src/utils/labels.ts`.

First, after the existing `genderTargetLabel` function (lines 57-59) and before the `AUDIT_ACTION` comment, insert:

```typescript
const BLOG_POST_STATUS: Record<string, LabelEntry> = {
  draft: { label: 'پیش‌نویس', tone: 'neutral' },
  published: { label: 'منتشرشده', tone: 'success' },
}

export function blogPostStatusLabel(status: string): LabelEntry {
  return BLOG_POST_STATUS[status] ?? { label: status, tone: 'neutral' }
}
```

Second, inside the `AUDIT_ACTION` map, after the existing `'report.resolve'` entry (line 71) and before the closing `}`, append the nine Plan 8 actions (keys are the exact backend `@AuditAction()` strings):

```typescript
  'post.create': { label: 'ایجاد مطلب بلاگ', tone: 'success' },
  'post.update': { label: 'ویرایش مطلب بلاگ', tone: 'info' },
  'post.publish': { label: 'انتشار مطلب بلاگ', tone: 'success' },
  'post.unpublish': { label: 'لغو انتشار مطلب بلاگ', tone: 'warning' },
  'post.delete': { label: 'حذف مطلب بلاگ', tone: 'danger' },
  'post.cover.set': { label: 'تغییر تصویر شاخص مطلب', tone: 'info' },
  'blogcategory.create': { label: 'ایجاد دسته‌بندی بلاگ', tone: 'success' },
  'blogcategory.update': { label: 'ویرایش دسته‌بندی بلاگ', tone: 'info' },
  'blogcategory.delete': { label: 'حذف دسته‌بندی بلاگ', tone: 'danger' },
```

Third, inside the `AUDIT_TARGET_TYPE` map, after the existing `report: 'گزارش',` entry (line 84), append the two Plan 8 target types (they otherwise render raw in the audit log — the fallback keeps working, this just makes them pretty):

```typescript
  post: 'مطلب بلاگ',
  blogcategory: 'دسته‌بندی بلاگ',
```

- [ ] **Step 8: Run the labels test to verify it passes**

Run: `pnpm --filter @gheychi/admin-panel test -- src/utils/labels.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Add the `newspaper` icon to `AppIcon.vue`**

In `apps/admin-panel/src/components/ui/AppIcon.vue`, extend the Lucide import (lines 7-13) — add `Newspaper` to the last line:

```typescript
import {
  LayoutDashboard, Store, Star, Grid2x2, Users, Settings2, LogOut,
  Check, X, ChevronLeft, ChevronRight, Search, CircleUser, Building2, TriangleAlert,
  Plus, Pencil, Scissors, Palette, Droplet, Gem, Sparkles, Paintbrush,
  Eye, Zap, Tag, Phone, Calendar, Lock, Sun, Moon, RotateCcw,
  History, Flag, Bell, Newspaper,
} from '@lucide/vue'
```

Extend the `IconName` union (lines 15-20) — change its last line:

```typescript
  | 'sun' | 'moon' | 'reset' | 'history' | 'flag' | 'bell' | 'newspaper'
```

And extend the `ICONS` map — after the existing `bell: Bell,` entry (line 58), add:

```typescript
  newspaper: Newspaper,
```

- [ ] **Step 10: Run the full admin-panel suite**

Run: `pnpm --filter @gheychi/admin-panel test`
Expected: exit code 0, all suites green (no other spec asserts on icon or label counts — `AuditLogView.spec.ts` was checked and does not).

- [ ] **Step 11: Commit**

```bash
git add apps/admin-panel/package.json pnpm-lock.yaml apps/admin-panel/src/utils/markdown.ts apps/admin-panel/src/utils/markdown.spec.ts apps/admin-panel/src/utils/labels.ts apps/admin-panel/src/utils/labels.spec.ts apps/admin-panel/src/components/ui/AppIcon.vue
git commit -m "feat(admin-panel): renderMarkdown utility, blog label maps, and newspaper icon"
```

### Task 10: `BlogPostsView` — posts list at `/blog` with categories side card, route, and nav entry

**Files:**
- Create: `apps/admin-panel/src/pages/BlogPostsView.vue`
- Test: `apps/admin-panel/src/pages/BlogPostsView.spec.ts` (create)
- Modify: `apps/admin-panel/src/router/index.ts` (:13-23 — new child route after `categories`)
- Modify: `apps/admin-panel/src/components/layout/SidebarNav.vue` (:6-15 — `LINKS` array)

The blog management landing page, per design doc §4.1: the standard list recipe (status + category filters via `AppSelect`, `Pagination`, silent loads with `EmptyState`) over `GET /api/admin/blog/posts`, plus a categories side card cloned from `CategoriesView`'s inline add/rename/delete-with-confirm pattern, retargeted at `/admin/blog/categories`. Categories are *read* from the public `GET /api/blog/categories` (id/name/slug — no admin variant exists or is needed) and feed both the side card and the filter dropdown.

Plan 7 house rules baked in: filter changes use the single-fetch idiom (`if (page.value !== 1) { page.value = 1 } else { load() }` — never reset-then-load); every category mutation has a synchronous re-entry guard and collapses its confirm/edit state on any outcome; mutations are **not** silent so the backend's Farsi 409s («این نامک قبلاً استفاده شده است» on duplicates, «این دسته‌بندی دارای مطلب است و قابل حذف نیست» on in-use delete) surface via the standard toast; after a successful mutation the category list is **reloaded** from the server rather than patched locally (the slug is server-generated), and a rename also reloads the posts table since rows display `categoryName`. The posts list itself has no destructive row actions (delete lives in the editor), so the page-step-back rule has no trigger here.

**Deliberate scope note:** only the `/blog` route is registered in this task. The `/blog/new` and `/blog/:id` routes from the shared contract are registered by the BlogEditorView task (the next admin task) together with the component file — registering a lazy `import('@/pages/BlogEditorView.vue')` before that file exists would break this task's `vite build` gate. Until then, the row-click/new-post navigations land on an unmatched route (a vue-router warning, not a crash) — acceptable for one task's window. No Playwright coverage is added (plan-wide rule); remember the frontend e2e global-setups wipe the shared dev DB, so don't run `test:e2e` casually while verifying.

- [ ] **Step 1: Write the failing page spec**

```typescript
// apps/admin-panel/src/pages/BlogPostsView.spec.ts
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import Pagination from '@/components/ui/Pagination.vue'
import BlogPostsView from './BlogPostsView.vue'

const fetchMock = vi.fn()
const pushMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

// The view only needs router.push -- rows and the new-post button navigate imperatively.
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

const categoriesFixture = [
  { id: 1, name: 'مراقبت مو', slug: 'moraghebat-mou' },
  { id: 2, name: 'مراقبت پوست', slug: 'moraghebat-poust' },
]

const draftPost = {
  id: 'p1',
  title: 'راهنمای انتخاب رنگ مو',
  slug: 'rahnamaye-entekhab-rang-mou',
  status: 'draft',
  categoryName: 'مراقبت مو',
  publishedAt: null,
  createdAt: '2026-07-08T08:00:00.000Z',
}

const publishedPost = {
  id: 'p2',
  title: 'ترندهای میکاپ تابستان',
  slug: 'trendhaye-mikap-tabestan',
  status: 'published',
  categoryName: null,
  publishedAt: '2026-07-01T08:00:00.000Z',
  createdAt: '2026-06-20T08:00:00.000Z',
}

let postsResponse: { items: unknown[]; total: number; page: number; pageSize: number }
let categoryMutationResult: { data: unknown; error: { status: number; message: string } | null }

function postListCalls() {
  return fetchMock.mock.calls.filter(([path]) => typeof path === 'string' && path.startsWith('/admin/blog/posts'))
}

function categoryListCalls() {
  return fetchMock.mock.calls.filter(([path]) => path === '/blog/categories')
}

beforeEach(() => {
  fetchMock.mockReset()
  pushMock.mockReset()
  postsResponse = { items: [draftPost, publishedPost], total: 2, page: 1, pageSize: 20 }
  categoryMutationResult = { data: { id: 3, name: 'جدید', slug: 'jadid' }, error: null }

  // Dispatch by URL + method: this view interleaves posts loads, category loads, and
  // category mutations, so an ordered mockResolvedValueOnce chain would be brittle.
  fetchMock.mockImplementation(async (path: string, options: { method?: string } = {}) => {
    const method = options.method ?? 'GET'
    if (method === 'GET' && path === '/blog/categories') {
      return { data: categoriesFixture.map((c) => ({ ...c })), error: null }
    }
    if (method === 'GET' && path.startsWith('/admin/blog/posts?')) {
      return { data: postsResponse, error: null }
    }
    if (path.startsWith('/admin/blog/categories')) {
      return categoryMutationResult
    }
    throw new Error(`unexpected apiFetch: ${method} ${path}`)
  })
})

async function mountView() {
  const wrapper = mount(BlogPostsView)
  await flushPromises()
  return wrapper
}

describe('BlogPostsView list', () => {
  it('loads page 1 silently on mount and renders rows with category, badge, and fa-IR date', async () => {
    const wrapper = await mountView()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/posts?status=all&page=1&pageSize=20', { silent: true })
    const rows = wrapper.findAll('[data-testid="post-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('راهنمای انتخاب رنگ مو')
    expect(rows[0].text()).toContain('مراقبت مو')
    expect(rows[0].text()).toContain('پیش‌نویس')
    expect(rows[0].text()).toContain('—') // draft: no publish date yet
    expect(rows[1].text()).toContain('منتشرشده')
    expect(rows[1].text()).toContain('۱۴۰۵') // fa-IR (Persian calendar) year for 2026-07-01
  })

  it('shows an empty state when nothing matches', async () => {
    postsResponse = { items: [], total: 0, page: 1, pageSize: 20 }
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="post-row"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('مطلبی با این فیلترها یافت نشد.')
  })

  it('resets to page 1 with exactly one request when a filter changes past page 1', async () => {
    postsResponse = { items: [draftPost], total: 45, page: 1, pageSize: 20 }
    const wrapper = await mountView()
    expect(postListCalls()).toHaveLength(1)

    wrapper.getComponent(Pagination).vm.$emit('update:page', 2)
    await flushPromises()
    expect(postListCalls()).toHaveLength(2)
    expect(postListCalls()[1][0]).toContain('page=2')

    // AppSelect order in the template: [0] status, [1] category.
    wrapper.findAllComponents(AppSelect)[0].vm.$emit('update:modelValue', 'draft')
    await flushPromises()

    const calls = postListCalls()
    expect(calls).toHaveLength(3) // one request -- not a reset-then-load double fetch
    expect(calls[2][0]).toContain('status=draft')
    expect(calls[2][0]).toContain('page=1')
  })

  it('reloads directly when a filter changes while already on page 1', async () => {
    const wrapper = await mountView()

    wrapper.findAllComponents(AppSelect)[1].vm.$emit('update:modelValue', 1)
    await flushPromises()

    const calls = postListCalls()
    expect(calls).toHaveLength(2)
    expect(calls[1][0]).toContain('categoryId=1')
    expect(calls[1][0]).toContain('page=1')
  })

  it('navigates to the editor on row click and to create mode from the new-post button', async () => {
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="post-row"]')[0].trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/blog/p1')

    await wrapper.get('[data-testid="new-post"]').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/blog/new')
  })
})

describe('BlogPostsView categories card', () => {
  it('lists the categories from the public endpoint', async () => {
    const wrapper = await mountView()

    expect(fetchMock).toHaveBeenCalledWith('/blog/categories', { silent: true })
    expect(wrapper.text()).toContain('مراقبت مو')
    expect(wrapper.text()).toContain('مراقبت پوست')
  })

  it('adds a category and reloads the list from the server instead of patching locally', async () => {
    const wrapper = await mountView()
    expect(categoryListCalls()).toHaveLength(1)

    await wrapper.get('[data-testid="new-category-name"]').setValue('عروس')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/categories', { method: 'POST', body: { name: 'عروس' } })
    expect(categoryListCalls()).toHaveLength(2) // reloaded -- the slug is server-generated
  })

  it('renames via inline edit, then reloads categories AND posts (rows show categoryName)', async () => {
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="edit-category"]')[0].trigger('click')
    await wrapper.get('[data-testid="edit-category-name"]').setValue('مو و ریش')
    await wrapper.get('[data-testid="save-category"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/categories/1', { method: 'PATCH', body: { name: 'مو و ریش' } })
    expect(categoryListCalls()).toHaveLength(2)
    expect(postListCalls()).toHaveLength(2)
  })

  it('expands an inline confirm without deleting anything yet', async () => {
    const wrapper = await mountView()
    const callsBefore = fetchMock.mock.calls.length

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')
    expect(wrapper.find('[data-testid="confirm-delete-category"]').exists()).toBe(true)
    expect(fetchMock.mock.calls).toHaveLength(callsBefore)

    await wrapper.get('[data-testid="cancel-delete-category"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-delete-category"]').exists()).toBe(false)
  })

  it('keeps the row and collapses the confirm strip on a 409 (category in use)', async () => {
    categoryMutationResult = {
      data: null,
      error: { status: 409, message: 'این دسته‌بندی دارای مطلب است و قابل حذف نیست' },
    }
    const wrapper = await mountView()

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')
    await wrapper.get('[data-testid="confirm-delete-category"]').trigger('click')
    await flushPromises()

    // The Farsi 409 toast comes from the real (non-silent) useApi; here we assert the
    // state outcome: row survives, confirm strip collapsed (no doomed retry form).
    expect(wrapper.text()).toContain('مراقبت مو')
    expect(wrapper.find('[data-testid="confirm-delete-category"]').exists()).toBe(false)
  })

  it('resets the category filter (and reloads unfiltered) when the filtered category is deleted', async () => {
    categoryMutationResult = { data: null, error: null } // 204
    const wrapper = await mountView()

    wrapper.findAllComponents(AppSelect)[1].vm.$emit('update:modelValue', 1)
    await flushPromises()
    expect(postListCalls().at(-1)![0]).toContain('categoryId=1')

    await wrapper.findAll('[data-testid="delete-category"]')[0].trigger('click')
    await wrapper.get('[data-testid="confirm-delete-category"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/categories/1', { method: 'DELETE' })
    const last = postListCalls().at(-1)![0]
    expect(last).not.toContain('categoryId=')
    expect(last).toContain('page=1')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run (from repo root): `pnpm --filter @gheychi/admin-panel test -- src/pages/BlogPostsView.spec.ts`
Expected: FAIL — `Failed to resolve import "./BlogPostsView.vue"` (the page does not exist yet).

- [ ] **Step 3: Implement `BlogPostsView.vue`**

```vue
<!-- apps/admin-panel/src/pages/BlogPostsView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Pagination from '@/components/ui/Pagination.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { blogPostStatusLabel } from '@/utils/labels'

interface BlogCategory {
  id: number
  name: string
  slug: string
}

interface BlogPostRow {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published'
  categoryName: string | null
  publishedAt: string | null
  createdAt: string
}

interface BlogPostListResponse {
  items: BlogPostRow[]
  total: number
  page: number
  pageSize: number
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'همه وضعیت‌ها' },
  { value: 'draft', label: 'پیش‌نویس' },
  { value: 'published', label: 'منتشرشده' },
]

const router = useRouter()
const { apiFetch } = useApi()

// ---- posts list ----
const posts = ref<BlogPostRow[]>([])
const loading = ref(true)
const page = ref(1)
const total = ref(0)
const pageSize = 20

const statusFilter = ref<'all' | 'draft' | 'published'>('all')
const categoryFilter = ref<number | ''>('')

async function load() {
  loading.value = true
  const params = new URLSearchParams({ status: statusFilter.value, page: String(page.value), pageSize: String(pageSize) })
  if (categoryFilter.value !== '') params.set('categoryId', String(categoryFilter.value))

  const { data } = await apiFetch<BlogPostListResponse>(`/admin/blog/posts?${params.toString()}`, { silent: true })
  posts.value = data?.items ?? []
  total.value = data?.total ?? 0
  loading.value = false
}

// Single-fetch idiom: past page 1, only reset the page and let watch(page) issue the
// request -- resetting AND calling load() here would double-fetch.
function loadFromFilterChange() {
  if (page.value !== 1) {
    page.value = 1
  } else {
    load()
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

function openPost(post: BlogPostRow) {
  router.push(`/blog/${post.id}`)
}

function goToCreate() {
  router.push('/blog/new')
}

// ---- categories side card (CategoriesView pattern, retargeted at /admin/blog/categories) ----
const categories = ref<BlogCategory[]>([])
const newName = ref('')
const editingId = ref<number | null>(null)
const editName = ref('')
const submitting = ref(false)
const confirmingId = ref<number | null>(null)

const categoryOptions = computed(() => [
  { value: '', label: 'همه دسته‌بندی‌ها' },
  ...categories.value.map((c) => ({ value: c.id, label: c.name })),
])

async function loadCategories() {
  const { data } = await apiFetch<BlogCategory[]>('/blog/categories', { silent: true })
  categories.value = data ?? []
}

async function addCategory() {
  if (submitting.value) return
  submitting.value = true
  // Deliberately NOT silent: a duplicate name/slug comes back 409 with a Farsi message,
  // surfaced through the standard toast path.
  const { data } = await apiFetch<BlogCategory>('/admin/blog/categories', {
    method: 'POST',
    body: { name: newName.value },
  })
  submitting.value = false
  if (data) {
    newName.value = ''
    await loadCategories() // the slug is server-generated -- reload rather than patch locally
  }
}

function startEdit(category: BlogCategory) {
  editingId.value = category.id
  editName.value = category.name
  confirmingId.value = null
}

async function saveEdit() {
  if (submitting.value) return
  const id = editingId.value
  if (id === null) return
  submitting.value = true
  // NOT silent: a rename can 409 on a duplicate name -- toast carries the Farsi message.
  const { error } = await apiFetch<BlogCategory>(`/admin/blog/categories/${id}`, {
    method: 'PATCH',
    body: { name: editName.value },
  })
  submitting.value = false
  editingId.value = null // collapse whether it worked or not -- no doomed retry form
  if (!error) {
    await loadCategories()
    await load() // table rows display categoryName -- a rename must show up there too
  }
}

function askDelete(category: BlogCategory) {
  confirmingId.value = category.id
  editingId.value = null
}

function cancelDelete() {
  confirmingId.value = null
}

async function confirmDelete() {
  if (submitting.value) return
  const id = confirmingId.value
  if (id === null) return
  submitting.value = true
  // NOT silent: an in-use category answers 409 «این دسته‌بندی دارای مطلب است و قابل حذف نیست»,
  // surfaced through the standard toast path.
  const { error } = await apiFetch(`/admin/blog/categories/${id}`, { method: 'DELETE' })
  submitting.value = false
  confirmingId.value = null // collapse the confirm strip whatever happened
  if (!error) {
    if (categoryFilter.value === id) {
      // The active filter pointed at the deleted category -- reset it; the filter
      // watcher reloads the (now unfiltered) posts list.
      categoryFilter.value = ''
    }
    await loadCategories()
  }
}

onMounted(() => {
  load()
  loadCategories()
})
watch([statusFilter, categoryFilter], loadFromFilterChange)
watch(page, load)
</script>

<template>
  <div class="flex flex-col gap-5 p-8 xl:flex-row xl:items-start">
    <div class="min-w-0 flex-1 space-y-5">
      <AppCard :padded="false" class="p-4">
        <div class="flex flex-wrap items-end gap-3">
          <div data-testid="status-filter">
            <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">وضعیت</label>
            <AppSelect v-model="statusFilter" :options="STATUS_OPTIONS" width="11rem" />
          </div>
          <div data-testid="category-filter">
            <label class="mb-1.5 block text-xs font-semibold text-(--color-muted)">دسته‌بندی</label>
            <AppSelect v-model="categoryFilter" :options="categoryOptions" width="12rem" />
          </div>
          <button
            data-testid="new-post"
            type="button"
            class="ms-auto inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            @click="goToCreate"
          >
            <AppIcon name="plus" :size="16" />
            مطلب جدید
          </button>
        </div>
      </AppCard>

      <EmptyState v-if="!loading && posts.length === 0" icon="newspaper" message="مطلبی با این فیلترها یافت نشد." />

      <AppCard v-else :padded="false" class="overflow-hidden">
        <table class="w-full text-right text-sm">
          <thead>
            <tr class="border-b border-(--color-border) bg-(--color-border-soft) text-xs text-(--color-muted)">
              <th class="px-5 py-3 font-semibold">عنوان</th>
              <th class="px-5 py-3 font-semibold">دسته‌بندی</th>
              <th class="px-5 py-3 font-semibold">وضعیت</th>
              <th class="px-5 py-3 font-semibold">تاریخ انتشار</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="post in posts"
              :key="post.id"
              data-testid="post-row"
              class="cursor-pointer border-b border-(--color-border-soft) transition-colors last:border-0 hover:bg-(--color-border-soft)"
              @click="openPost(post)"
            >
              <td class="px-5 py-3.5 font-semibold text-(--color-text)">{{ post.title }}</td>
              <td class="px-5 py-3.5 text-(--color-muted)">{{ post.categoryName ?? '—' }}</td>
              <td class="px-5 py-3.5">
                <StatusBadge :label="blogPostStatusLabel(post.status).label" :tone="blogPostStatusLabel(post.status).tone" />
              </td>
              <td class="tnum px-5 py-3.5 text-(--color-muted)">{{ formatDate(post.publishedAt) }}</td>
            </tr>
          </tbody>
        </table>
        <Pagination :page="page" :page-size="pageSize" :total="total" @update:page="(p) => (page = p)" />
      </AppCard>
    </div>

    <AppCard class="w-full shrink-0 xl:w-80">
      <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
        <AppIcon name="categories" :size="16" class="text-(--color-accent)" />
        دسته‌بندی‌های بلاگ
      </p>

      <form class="mb-4 flex gap-2" @submit.prevent="addCategory">
        <!-- maxlength 60 = CreateBlogCategoryDto's @Length cap (blog_categories.name varchar(60)) -->
        <input
          v-model="newName"
          data-testid="new-category-name"
          placeholder="نام دسته‌بندی"
          maxlength="60"
          class="min-w-0 flex-1 rounded-xl border border-(--color-border) p-2.5 text-sm"
        />
        <button
          data-testid="add-category"
          type="submit"
          :disabled="submitting || !newName.trim()"
          class="inline-flex shrink-0 items-center rounded-xl bg-(--color-accent) px-3 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <AppIcon name="plus" :size="16" />
        </button>
      </form>

      <div class="space-y-2">
        <div
          v-for="category in categories"
          :key="category.id"
          class="flex items-center gap-2 rounded-xl border border-(--color-border-soft) p-2.5"
        >
          <template v-if="confirmingId === category.id">
            <span class="min-w-0 flex-1 truncate text-sm font-semibold text-(--tone-danger-text)">
              «{{ category.name }}» حذف شود؟
            </span>
            <button
              data-testid="confirm-delete-category"
              type="button"
              :disabled="submitting"
              class="shrink-0 text-sm font-semibold text-(--tone-danger-text) disabled:opacity-40"
              @click="confirmDelete"
            >
              حذف
            </button>
            <button
              data-testid="cancel-delete-category"
              type="button"
              :disabled="submitting"
              class="shrink-0 text-sm font-semibold text-(--color-muted) disabled:opacity-40"
              @click="cancelDelete"
            >
              انصراف
            </button>
          </template>

          <template v-else>
            <input
              v-if="editingId === category.id"
              v-model="editName"
              data-testid="edit-category-name"
              maxlength="60"
              class="min-w-0 flex-1 rounded-lg border border-(--color-border) p-1.5 text-sm"
            />
            <span v-else class="min-w-0 flex-1 truncate text-sm font-semibold text-(--color-text)">{{ category.name }}</span>
            <button
              v-if="editingId === category.id"
              data-testid="save-category"
              type="button"
              :disabled="submitting"
              class="shrink-0 text-sm font-semibold text-(--color-accent) disabled:opacity-40"
              @click="saveEdit"
            >
              ذخیره
            </button>
            <template v-else>
              <button
                data-testid="edit-category"
                type="button"
                :disabled="submitting"
                class="shrink-0 rounded-lg p-1.5 text-(--color-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-accent) disabled:opacity-40"
                title="ویرایش"
                @click="startEdit(category)"
              >
                <AppIcon name="pencil" :size="15" />
              </button>
              <button
                data-testid="delete-category"
                type="button"
                :disabled="submitting"
                class="shrink-0 rounded-lg p-1.5 text-(--color-muted) transition-colors hover:bg-(--tone-danger-bg) hover:text-(--tone-danger-text) disabled:opacity-40"
                title="حذف"
                @click="askDelete(category)"
              >
                <AppIcon name="x" :size="15" />
              </button>
            </template>
          </template>
        </div>
        <p v-if="categories.length === 0" class="py-4 text-center text-xs text-(--color-muted)">
          هنوز دسته‌بندی‌ای ساخته نشده است.
        </p>
      </div>
    </AppCard>
  </div>
</template>
```

- [ ] **Step 4: Run the page spec to verify it passes**

Run: `pnpm --filter @gheychi/admin-panel test -- src/pages/BlogPostsView.spec.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Register the route and the nav entry**

In `apps/admin-panel/src/router/index.ts`, inside the `AppLayout` children (lines 13-23), after the existing `categories` entry:

```typescript
      { path: 'categories', name: 'categories', component: () => import('@/pages/CategoriesView.vue'), meta: { title: 'دسته‌بندی‌ها' } },
```

add:

```typescript
      { path: 'blog', name: 'blog', component: () => import('@/pages/BlogPostsView.vue'), meta: { title: 'بلاگ' } },
```

(`/blog/new` and `/blog/:id` are added by the BlogEditorView task together with the component file — see the scope note above.)

In `apps/admin-panel/src/components/layout/SidebarNav.vue`, update the `LINKS` array (lines 6-15) to include بلاگ after دسته‌بندی‌ها:

```typescript
const LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'داشبورد', icon: 'dashboard' },
  { to: '/salons', label: 'آرایشگاه‌ها', icon: 'salons' },
  { to: '/reviews', label: 'نظرات', icon: 'reviews' },
  { to: '/reports', label: 'گزارش‌ها', icon: 'flag' },
  { to: '/categories', label: 'دسته‌بندی‌ها', icon: 'categories' },
  { to: '/blog', label: 'بلاگ', icon: 'newspaper' },
  { to: '/users', label: 'کاربران', icon: 'users' },
  { to: '/audit-log', label: 'تاریخچه اقدامات', icon: 'history' },
  { to: '/config', label: 'تنظیمات', icon: 'config' },
]
```

`SidebarNav`'s `isActive` already prefix-matches (`route.path.startsWith('/blog/')`), so the nav entry will highlight correctly on the editor routes once they exist. The router guard spec (`src/router/index.spec.ts`) only exercises login/forbidden/dashboard redirects and needs no change.

- [ ] **Step 6: Run the full admin-panel suite**

Run: `pnpm --filter @gheychi/admin-panel test`
Expected: exit code 0, all suites green.

- [ ] **Step 7: Run the admin-panel build gate**

Run: `pnpm --filter @gheychi/admin-panel build`
Expected: exit code 0 — `vue-tsc -b` type-checks the new page and templates, and `vite build` proves the lazy `import('@/pages/BlogPostsView.vue')` resolves.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-panel/src/pages/BlogPostsView.vue apps/admin-panel/src/pages/BlogPostsView.spec.ts apps/admin-panel/src/router/index.ts apps/admin-panel/src/components/layout/SidebarNav.vue
git commit -m "feat(admin-panel): blog posts list at /blog with categories side card and nav entry"
```

### Task 11: Admin blog editor — `BlogEditorView` with live markdown preview, cover upload, publish workflow

**Files:**
- Create: `apps/admin-panel/src/utils/slug-preview.ts`
- Create: `apps/admin-panel/src/utils/slug-preview.spec.ts`
- Create: `apps/admin-panel/src/pages/BlogEditorView.vue`
- Modify: `apps/admin-panel/src/router/index.ts` (:14-23 — children array)
- Test: `apps/admin-panel/src/pages/BlogEditorView.spec.ts` (create)

The editor behind `/blog/new` (create) and `/blog/:id` (edit). Slug handling is deliberately asymmetric, matching the API surface (create has no slug field; PATCH does):

- **Create never sends a slug.** The backend's `makeSlug` (`apps/api/src/common/slug.util.ts`, Task 2) derives the authoritative slug — including its random uniqueness suffix — so the editor's slug field is only a client-side *preview* (`previewSlug`, transliteration-free: Persian letters kept as-is) that auto-fills from the title until the admin types into it (a `slugDirty` flag). If the admin *did* edit it before saving, the editor sends a **follow-up `PATCH { slug }`** right after the `POST` succeeds; a 409 «این نامک قبلاً استفاده شده است» on that PATCH surfaces through the standard toast without losing the created draft, and the subsequent editor load shows the server's slug.
- **Edit always sends the slug field's current value** in the PATCH alongside the other fields.

Cover upload is edit-mode only (the multipart endpoint is `POST /admin/blog/posts/:id/cover` — there is no id yet in create mode); create mode shows a hint instead. After a cover set/remove succeeds the editor **reloads the post via GET** rather than trusting a locally derived URL — `GET /admin/blog/posts/:id` returns `coverImageUrl` derived exactly the way the public endpoints serve it (the salon-photos mechanism), so reloading keeps the preview truthful and sidesteps any assumption about the mutation responses' shape. The multipart field name is `file`, mirroring `SalonPhotosController`'s `FileInterceptor('file', ...)`.

Publish/unpublish are conditional updates server-side; a lost race answers 409 with a Farsi message. The handlers are deliberately **not** silent (toast surfaces) and **always reload from the server afterwards** — on success and on race alike — instead of patching `status` locally. All mutating actions share one synchronous `submitting` re-entry guard + disabled states; delete uses the inline expand-to-confirm pattern from Task 20 of Plan 7, and every failure path collapses the confirm strip.

`useApi` was verified to already support `FormData` bodies (`apps/admin-panel/src/composables/useApi.ts:25-37` — `body instanceof FormData` skips the JSON `Content-Type` header and passes the body through), so no extension is needed.

- [ ] **Step 1: Preflight, then write the failing utility test**

Preflight: verify `apps/admin-panel/src/utils/markdown.ts` exists (created by Task 9) — stop and report if missing. The editor below imports `renderMarkdown` from that utility; this task does not create it.

```typescript
// apps/admin-panel/src/utils/slug-preview.spec.ts
import { describe, expect, it } from 'vitest'
import { previewSlug } from './slug-preview'

describe('previewSlug', () => {
  it('keeps Persian letters and dashes the word gaps (no transliteration)', () => {
    expect(previewSlug('راهنمای مراقبت از مو')).toBe('راهنمای-مراقبت-از-مو')
  })

  it('lowercases Latin and strips symbols', () => {
    expect(previewSlug('Top 10 Hair Tips!')).toBe('top-10-hair-tips')
  })

  it('collapses dash runs and trims edge dashes', () => {
    expect(previewSlug('  سلام -- دنیا  ')).toBe('سلام-دنیا')
  })

  it('turns ZWNJ (نیم‌فاصله) into a dash', () => {
    expect(previewSlug('می‌خواهم')).toBe('می-خواهم')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/admin-panel test -- src/utils/slug-preview.spec.ts`
Expected: FAIL — `Failed to resolve import "./slug-preview"` (the file doesn't exist yet).

- [ ] **Step 3: Implement the slug-preview utility**

```typescript
// apps/admin-panel/src/utils/slug-preview.ts
// Client-side *preview* of the slug the backend derives from a title. The authoritative slug
// is generated server-side on create (apps/api/src/common/slug.util.ts adds a random
// uniqueness suffix); this helper only fills the editor's slug field until the admin edits it
// manually. Transliteration-free by design: Persian letters (U+0600–U+06FF, which includes
// Persian digits) are kept as-is -- URLs percent-encode them -- Latin is lowercased, and every
// other run of characters (spaces, ZWNJ, punctuation) collapses to a single dash.
export function previewSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
```

- [ ] **Step 4: Run the utility test to verify it passes**

Run: `pnpm --filter @gheychi/admin-panel test -- src/utils/slug-preview.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing editor spec**

URL/method-dispatched mocks throughout (the editor makes up to four different calls per flow) — never ordered `mockResolvedValueOnce` chains. `AppSelect` is stubbed (it wraps vue-multiselect; the category dropdown isn't under test here).

```typescript
// apps/admin-panel/src/pages/BlogEditorView.spec.ts
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import BlogEditorView from './BlogEditorView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const POST = {
  id: 'p1',
  title: 'راهنمای رنگ مو',
  slug: 'rang-mou-1a2b',
  excerpt: null,
  bodyMarkdown: '# سلام',
  coverImageUrl: null,
  categoryId: null,
  authorName: null,
  metaDescription: null,
  ogTitle: null,
  status: 'draft',
  publishedAt: null,
}

// Dispatch by URL+method so every flow (initial GET, categories GET, create POST, slug
// PATCH, publish POST, unpublish POST, DELETE) resolves independently of call order.
function dispatchFetch(
  options: { publishError?: { status: number; message: string }; initial?: Partial<typeof POST> } = {},
) {
  let current: Record<string, unknown> = { ...POST, ...options.initial }
  fetchMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? 'GET'
    if (method === 'GET' && path === '/blog/categories') {
      return { data: [{ id: 1, name: 'مو', slug: 'mou' }], error: null }
    }
    if (method === 'GET' && path === '/admin/blog/posts/p1') return { data: { ...current }, error: null }
    if (method === 'POST' && path === '/admin/blog/posts') return { data: { ...current }, error: null }
    if (method === 'PATCH' && path === '/admin/blog/posts/p1') {
      current = { ...current, ...(opts?.body as Record<string, unknown>) }
      return { data: { ...current }, error: null }
    }
    if (method === 'POST' && path === '/admin/blog/posts/p1/publish') {
      if (options.publishError) return { data: null, error: options.publishError }
      current = { ...current, status: 'published', publishedAt: '2026-07-10T10:00:00.000Z' }
      return { data: { ...current }, error: null }
    }
    if (method === 'POST' && path === '/admin/blog/posts/p1/unpublish') {
      current = { ...current, status: 'draft' }
      return { data: { ...current }, error: null }
    }
    if (method === 'DELETE' && path === '/admin/blog/posts/p1') return { data: null, error: null }
    throw new Error(`unexpected fetch in test: ${method} ${path}`)
  })
}

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/blog', component: { template: '<div />' } },
      { path: '/blog/new', component: BlogEditorView },
      { path: '/blog/:id', component: BlogEditorView },
    ],
  })
  router.push(path)
  await router.isReady()
  const wrapper = mount(BlogEditorView, {
    global: { plugins: [router], stubs: { AppSelect: true } },
  })
  await flushPromises()
  return { wrapper, router }
}

// Counts the plain (method-less) GETs of the post -- i.e. initial load + reloads.
function postLoads() {
  return fetchMock.mock.calls.filter(
    ([p, o]) => p === '/admin/blog/posts/p1' && !(o as { method?: string } | undefined)?.method,
  ).length
}

describe('BlogEditorView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    dispatchFetch()
  })

  it('renders the live preview with markdown parsed and raw HTML escaped', async () => {
    const { wrapper } = await mountAt('/blog/new')

    await wrapper.get('[data-testid="body-input"]').setValue('# عنوان تست\n\n<script>alert(1)</script>')

    const preview = wrapper.get('[data-testid="preview"]').element.innerHTML
    expect(preview).toContain('<h1>عنوان تست</h1>')
    expect(preview).toContain('&lt;script&gt;')
    expect(preview).not.toContain('<script>')
  })

  it('creates without sending a slug (auto preview untouched) and routes to /blog/:id', async () => {
    const { wrapper, router } = await mountAt('/blog/new')

    await wrapper.get('[data-testid="title-input"]').setValue('راهنمای مراقبت از مو')
    await wrapper.get('[data-testid="body-input"]').setValue('متن مطلب')
    // The slug field previews the title client-side until manually edited.
    expect((wrapper.get('[data-testid="slug-input"]').element as HTMLInputElement).value).toBe(
      'راهنمای-مراقبت-از-مو',
    )

    await wrapper.get('[data-testid="save-button"]').trigger('click')
    await flushPromises()

    const createCall = fetchMock.mock.calls.find(([p]) => p === '/admin/blog/posts')
    expect(createCall?.[1]).toMatchObject({ method: 'POST' })
    expect((createCall?.[1] as { body: Record<string, unknown> }).body).not.toHaveProperty('slug')
    // No manual slug edit -> no follow-up PATCH.
    expect(
      fetchMock.mock.calls.some(
        ([p, o]) => p === '/admin/blog/posts/p1' && (o as { method?: string })?.method === 'PATCH',
      ),
    ).toBe(false)
    expect(router.currentRoute.value.fullPath).toBe('/blog/p1')
  })

  it('applies a manually edited slug with a follow-up PATCH after create', async () => {
    const { wrapper, router } = await mountAt('/blog/new')

    await wrapper.get('[data-testid="title-input"]').setValue('راهنمای مراقبت از مو')
    await wrapper.get('[data-testid="body-input"]').setValue('متن مطلب')
    await wrapper.get('[data-testid="slug-input"]').setValue('custom-slug')

    await wrapper.get('[data-testid="save-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/posts/p1', {
      method: 'PATCH',
      body: { slug: 'custom-slug' },
    })
    expect(router.currentRoute.value.fullPath).toBe('/blog/p1')
  })

  it('publishes and reloads the post from the server', async () => {
    const { wrapper } = await mountAt('/blog/p1')
    expect(wrapper.text()).toContain('پیش‌نویس')

    await wrapper.get('[data-testid="publish-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/posts/p1/publish', { method: 'POST' })
    expect(postLoads()).toBe(2) // initial load + post-publish reload
    expect(wrapper.text()).toContain('منتشرشده')
  })

  it('on a 409 lost publish race, still reloads instead of patching status locally', async () => {
    dispatchFetch({ publishError: { status: 409, message: 'این مطلب قبلاً منتشر شده است' } })
    const { wrapper } = await mountAt('/blog/p1')

    await wrapper.get('[data-testid="publish-button"]').trigger('click')
    await flushPromises()

    // The Farsi 409 message surfaced via the real useApi toast path (not silent); here we
    // assert the state machine: a reload happened and the badge reflects the server.
    expect(postLoads()).toBe(2)
    expect(wrapper.text()).toContain('پیش‌نویس')
  })

  it('unpublishes and reloads the post from the server', async () => {
    dispatchFetch({ initial: { status: 'published', publishedAt: '2026-07-08T10:00:00.000Z' } })
    const { wrapper } = await mountAt('/blog/p1')
    expect(wrapper.text()).toContain('منتشرشده')

    await wrapper.get('[data-testid="unpublish-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/posts/p1/unpublish', { method: 'POST' })
    expect(postLoads()).toBe(2) // initial load + post-unpublish reload
    expect(wrapper.text()).toContain('پیش‌نویس')
  })

  it('deletes only after the inline confirm, then routes back to /blog', async () => {
    const { wrapper, router } = await mountAt('/blog/p1')

    await wrapper.get('[data-testid="delete-button"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-delete"]').exists()).toBe(true)
    expect(fetchMock.mock.calls.some(([, o]) => (o as { method?: string } | undefined)?.method === 'DELETE')).toBe(false)

    await wrapper.get('[data-testid="confirm-delete"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/blog/posts/p1', { method: 'DELETE' })
    expect(router.currentRoute.value.fullPath).toBe('/blog')
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @gheychi/admin-panel test -- src/pages/BlogEditorView.spec.ts`
Expected: FAIL — `Failed to resolve import "./BlogEditorView.vue"` (the component doesn't exist yet).

- [ ] **Step 7: Implement `BlogEditorView.vue`**

```vue
<!-- apps/admin-panel/src/pages/BlogEditorView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { blogPostStatusLabel } from '@/utils/labels'
import { renderMarkdown } from '@/utils/markdown'
import { previewSlug } from '@/utils/slug-preview'

interface AdminBlogPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  bodyMarkdown: string
  coverImageUrl: string | null
  categoryId: number | null
  authorName: string | null
  metaDescription: string | null
  ogTitle: string | null
  status: 'draft' | 'published'
  publishedAt: string | null
}

interface BlogCategory {
  id: number
  name: string
  slug: string
}

const route = useRoute()
const router = useRouter()
const { apiFetch } = useApi()

const isCreate = computed(() => !route.params.id)
const postId = computed(() => route.params.id as string | undefined)

const post = ref<AdminBlogPost | null>(null)
const notFound = ref(false)

const title = ref('')
const slug = ref('')
const slugDirty = ref(false)
const categoryId = ref<string | number>('')
const authorName = ref('')
const excerpt = ref('')
const metaDescription = ref('')
const ogTitle = ref('')
const bodyMarkdown = ref('')
const seoOpen = ref(false)

const submitting = ref(false)
const confirmingDelete = ref(false)

const categories = ref<BlogCategory[]>([])
const categoryOptions = computed(() => [
  { value: '', label: 'بدون دسته‌بندی' },
  ...categories.value.map((c) => ({ value: c.id, label: c.name })),
])

// Bound below with v-html -- safe because renderMarkdown runs markdown-it with html:false,
// so raw HTML in the markdown source never parses (pinned by markdown.spec.ts).
const previewHtml = computed(() => renderMarkdown(bodyMarkdown.value))

// In create mode the slug field previews the title until the admin edits it manually; the
// backend's makeSlug produces the authoritative slug (with a uniqueness suffix) on create.
watch(title, (t) => {
  if (isCreate.value && !slugDirty.value) slug.value = previewSlug(t)
})

function onSlugInput() {
  slugDirty.value = true
}

function toggleSeo() {
  seoOpen.value = !seoOpen.value
}

function applyPost(p: AdminBlogPost) {
  post.value = p
  title.value = p.title
  slug.value = p.slug
  slugDirty.value = false
  categoryId.value = p.categoryId ?? ''
  authorName.value = p.authorName ?? ''
  excerpt.value = p.excerpt ?? ''
  metaDescription.value = p.metaDescription ?? ''
  ogTitle.value = p.ogTitle ?? ''
  bodyMarkdown.value = p.bodyMarkdown
}

async function load() {
  if (isCreate.value || !postId.value) return
  const { data, error } = await apiFetch<AdminBlogPost>(`/admin/blog/posts/${postId.value}`, { silent: true })
  if (data) {
    applyPost(data)
    notFound.value = false
    return
  }
  // Only a confirmed 404 flips to not-found -- a transient failure right after a
  // successful action must not wipe known-good editor state (same rationale as
  // SalonDetailView.load()).
  if (error?.status === 404) notFound.value = true
}

onMounted(async () => {
  await load()
  const { data } = await apiFetch<BlogCategory[]>('/blog/categories', { silent: true })
  categories.value = data ?? []
})

function basePayload() {
  return {
    title: title.value.trim(),
    bodyMarkdown: bodyMarkdown.value,
    excerpt: excerpt.value.trim() || null,
    categoryId: categoryId.value === '' ? null : Number(categoryId.value),
    authorName: authorName.value.trim() || null,
    metaDescription: metaDescription.value.trim() || null,
    ogTitle: ogTitle.value.trim() || null,
  }
}

async function save() {
  if (submitting.value) return
  if (!title.value.trim() || !bodyMarkdown.value.trim()) {
    useToast().push('عنوان و متن مطلب الزامی است')
    return
  }
  submitting.value = true
  confirmingDelete.value = false

  if (isCreate.value) {
    // Create never sends a slug -- the backend derives the authoritative one. A manually
    // edited slug is applied with a follow-up PATCH; its 409 («این نامک قبلاً استفاده شده
    // است») surfaces via the standard toast without losing the created draft.
    const { data } = await apiFetch<AdminBlogPost>('/admin/blog/posts', { method: 'POST', body: basePayload() })
    if (data) {
      if (slugDirty.value && slug.value.trim()) {
        await apiFetch(`/admin/blog/posts/${data.id}`, { method: 'PATCH', body: { slug: slug.value.trim() } })
      }
      submitting.value = false
      await router.replace(`/blog/${data.id}`)
      return
    }
  } else {
    const { data } = await apiFetch<AdminBlogPost>(`/admin/blog/posts/${postId.value}`, {
      method: 'PATCH',
      body: { ...basePayload(), slug: slug.value.trim() },
    })
    if (data) applyPost(data)
  }
  submitting.value = false
}

async function publish() {
  await transition('publish')
}

async function unpublish() {
  await transition('unpublish')
}

async function transition(action: 'publish' | 'unpublish') {
  if (submitting.value || !postId.value) return
  submitting.value = true
  confirmingDelete.value = false
  // Deliberately NOT silent: a lost publish/unpublish race answers 409 with a Farsi message
  // that surfaces through the standard toast. Either way the server is the truth afterwards,
  // so always reload instead of patching status locally.
  await apiFetch(`/admin/blog/posts/${postId.value}/${action}`, { method: 'POST' })
  await load()
  submitting.value = false
}

function askDelete() {
  confirmingDelete.value = true
}

function cancelDelete() {
  confirmingDelete.value = false
}

async function confirmDelete() {
  if (submitting.value || !postId.value) return
  submitting.value = true
  const { error } = await apiFetch(`/admin/blog/posts/${postId.value}`, { method: 'DELETE' })
  submitting.value = false
  confirmingDelete.value = false
  if (!error) await router.push('/blog')
}

async function onCoverChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-picking the same file after a failure
  if (!file || submitting.value || !postId.value) return
  submitting.value = true
  const form = new FormData()
  form.append('file', file) // same multipart field name as the salon-photos upload
  const { error } = await apiFetch(`/admin/blog/posts/${postId.value}/cover`, { method: 'POST', body: form })
  submitting.value = false
  // Reload rather than trusting a locally derived URL -- the GET returns coverImageUrl
  // exactly as the public endpoints will serve it.
  if (!error) await load()
}

async function removeCover() {
  if (submitting.value || !postId.value) return
  submitting.value = true
  const { error } = await apiFetch(`/admin/blog/posts/${postId.value}/cover`, { method: 'DELETE' })
  submitting.value = false
  if (!error) await load()
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-5 p-8">
    <EmptyState v-if="notFound" icon="warning" message="مطلب یافت نشد." />

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <h2 class="text-lg font-bold text-(--color-text)">{{ isCreate ? 'مطلب جدید' : 'ویرایش مطلب' }}</h2>
          <StatusBadge
            v-if="post"
            :label="blogPostStatusLabel(post.status).label"
            :tone="blogPostStatusLabel(post.status).tone"
          />
        </div>

        <div class="flex items-center gap-2">
          <template v-if="confirmingDelete">
            <span class="text-sm font-semibold text-(--tone-danger-text)">مطلب حذف شود؟</span>
            <button
              data-testid="confirm-delete"
              type="button"
              :disabled="submitting"
              class="rounded-lg bg-(--tone-danger-bg) px-3 py-1.5 text-sm font-semibold text-(--tone-danger-text) disabled:opacity-40"
              @click="confirmDelete"
            >
              حذف
            </button>
            <button
              data-testid="cancel-delete"
              type="button"
              :disabled="submitting"
              class="px-2 text-sm font-semibold text-(--color-muted) disabled:opacity-40"
              @click="cancelDelete"
            >
              انصراف
            </button>
          </template>
          <template v-else>
            <button
              data-testid="save-button"
              type="button"
              :disabled="submitting"
              class="rounded-lg bg-(--color-accent) px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              @click="save"
            >
              ذخیره
            </button>
            <button
              v-if="post?.status === 'draft'"
              data-testid="publish-button"
              type="button"
              :disabled="submitting"
              class="rounded-lg bg-(--tone-success-bg) px-4 py-1.5 text-sm font-semibold text-(--tone-success-text) disabled:opacity-40"
              @click="publish"
            >
              انتشار
            </button>
            <button
              v-if="post?.status === 'published'"
              data-testid="unpublish-button"
              type="button"
              :disabled="submitting"
              class="rounded-lg bg-(--tone-warning-bg) px-4 py-1.5 text-sm font-semibold text-(--tone-warning-text) disabled:opacity-40"
              @click="unpublish"
            >
              لغو انتشار
            </button>
            <button
              v-if="!isCreate"
              data-testid="delete-button"
              type="button"
              :disabled="submitting"
              class="rounded-lg px-3 py-1.5 text-sm font-semibold text-(--tone-danger-text) disabled:opacity-40"
              @click="askDelete"
            >
              حذف
            </button>
          </template>
        </div>
      </div>

      <div class="grid gap-5 lg:grid-cols-2">
        <div class="space-y-5">
          <AppCard class="space-y-4">
            <div>
              <label class="mb-1 block text-xs text-(--color-muted)" for="post-title">عنوان</label>
              <input
                id="post-title"
                v-model="title"
                data-testid="title-input"
                maxlength="200"
                class="w-full rounded-lg border border-(--color-border) p-2 text-sm"
              />
            </div>

            <div>
              <label class="mb-1 block text-xs text-(--color-muted)" for="post-slug">نامک</label>
              <input
                id="post-slug"
                v-model="slug"
                data-testid="slug-input"
                maxlength="220"
                dir="ltr"
                class="w-full rounded-lg border border-(--color-border) p-2 text-left text-sm"
                @input="onSlugInput"
              />
              <p v-if="isCreate" class="mt-1 text-xs text-(--color-muted)">
                نامک نهایی هنگام ایجاد توسط سرور ساخته می‌شود؛ این فیلد فقط پیش‌نمایش است مگر آن را دستی ویرایش کنید.
              </p>
              <p v-if="post?.status === 'published'" class="mt-1 text-xs text-(--tone-warning-text)">
                تغییر نامک مطلب منتشرشده، آدرس عمومی آن را تغییر می‌دهد.
              </p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="mb-1 block text-xs text-(--color-muted)">دسته‌بندی</label>
                <AppSelect v-model="categoryId" :options="categoryOptions" width="100%" />
              </div>
              <div>
                <label class="mb-1 block text-xs text-(--color-muted)" for="post-author">نویسنده</label>
                <input
                  id="post-author"
                  v-model="authorName"
                  data-testid="author-input"
                  maxlength="80"
                  class="w-full rounded-lg border border-(--color-border) p-2 text-sm"
                />
              </div>
            </div>

            <div>
              <div class="mb-1 flex items-center justify-between">
                <label class="text-xs text-(--color-muted)" for="post-excerpt">خلاصه</label>
                <span class="text-xs text-(--color-muted)">{{ excerpt.length }} / 500</span>
              </div>
              <!-- maxlength matches the blog DTO's excerpt cap (varchar(500) / @Length(0, 500)) -->
              <textarea
                id="post-excerpt"
                v-model="excerpt"
                data-testid="excerpt-input"
                maxlength="500"
                rows="3"
                class="w-full rounded-lg border border-(--color-border) p-2 text-sm"
              />
            </div>

            <div class="rounded-xl border border-(--color-border-soft)">
              <button
                data-testid="seo-toggle"
                type="button"
                class="flex w-full items-center justify-between p-3 text-sm font-semibold text-(--color-text)"
                @click="toggleSeo"
              >
                <span>تنظیمات سئو</span>
                <AppIcon :name="seoOpen ? 'x' : 'plus'" :size="15" />
              </button>
              <div v-if="seoOpen" class="space-y-3 border-t border-(--color-border-soft) p-3">
                <div>
                  <div class="mb-1 flex items-center justify-between">
                    <label class="text-xs text-(--color-muted)" for="post-meta-description">توضیح متا</label>
                    <span class="text-xs text-(--color-muted)">{{ metaDescription.length }} / 300</span>
                  </div>
                  <!-- maxlength matches the blog DTO's metaDescription cap (varchar(300) / @Length(0, 300)) -->
                  <textarea
                    id="post-meta-description"
                    v-model="metaDescription"
                    data-testid="meta-description-input"
                    maxlength="300"
                    rows="3"
                    class="w-full rounded-lg border border-(--color-border) p-2 text-sm"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-(--color-muted)" for="post-og-title">عنوان اشتراک‌گذاری (og:title)</label>
                  <!-- maxlength matches the blog DTO's ogTitle cap (varchar(200) / @Length(0, 200)) -->
                  <input
                    id="post-og-title"
                    v-model="ogTitle"
                    data-testid="og-title-input"
                    maxlength="200"
                    class="w-full rounded-lg border border-(--color-border) p-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div v-if="!isCreate" class="space-y-3">
              <p class="text-sm font-semibold text-(--color-text)">تصویر کاور</p>
              <img
                v-if="post?.coverImageUrl"
                :src="post.coverImageUrl"
                alt="کاور مطلب"
                class="h-40 w-full rounded-xl object-cover"
              />
              <div class="flex items-center gap-3">
                <label class="cursor-pointer rounded-lg bg-(--color-border-soft) px-3 py-1.5 text-sm font-semibold text-(--color-accent)">
                  {{ post?.coverImageUrl ? 'تعویض کاور' : 'بارگذاری کاور' }}
                  <input
                    data-testid="cover-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    class="hidden"
                    :disabled="submitting"
                    @change="onCoverChange"
                  />
                </label>
                <button
                  v-if="post?.coverImageUrl"
                  data-testid="remove-cover"
                  type="button"
                  :disabled="submitting"
                  class="text-sm font-semibold text-(--tone-danger-text) disabled:opacity-40"
                  @click="removeCover"
                >
                  حذف کاور
                </button>
              </div>
            </div>
            <p v-else class="text-xs text-(--color-muted)">برای بارگذاری کاور، ابتدا پیش‌نویس را ذخیره کنید.</p>

            <div>
              <label class="mb-1 block text-xs text-(--color-muted)" for="post-body">متن مطلب (Markdown)</label>
              <textarea
                id="post-body"
                v-model="bodyMarkdown"
                data-testid="body-input"
                rows="18"
                dir="auto"
                class="w-full rounded-lg border border-(--color-border) p-2 font-mono text-sm leading-6"
              />
            </div>
          </AppCard>
        </div>

        <AppCard class="self-start">
          <p class="mb-3 text-xs font-semibold text-(--color-muted)">پیش‌نمایش</p>
          <!-- sanctioned v-html: renderMarkdown uses html:false so raw HTML never parses — see its invariant test -->
          <div data-testid="preview" class="space-y-3 text-sm leading-7 text-(--color-text)" v-html="previewHtml" />
        </AppCard>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 8: Run the editor spec to verify it passes**

Run: `pnpm --filter @gheychi/admin-panel test -- src/pages/BlogEditorView.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 9: Register the editor routes**

In `apps/admin-panel/src/router/index.ts`, the BlogPostsView task has already added the `blog` list route to the `children` array (after the `categories` entry). Add the two editor routes **immediately after it** — `blog/new` before `blog/:id` so the static segment is registered ahead of the param route:

```typescript
      { path: 'blog/new', name: 'blog-new', component: () => import('@/pages/BlogEditorView.vue'), meta: { title: 'مطلب جدید' } },
      { path: 'blog/:id', name: 'blog-editor', component: () => import('@/pages/BlogEditorView.vue'), meta: { title: 'ویرایش مطلب' } },
```

For reference, the surrounding children today (before this plan's list-view task) end with:

```typescript
      { path: 'categories', name: 'categories', component: () => import('@/pages/CategoriesView.vue'), meta: { title: 'دسته‌بندی‌ها' } },
      { path: 'users', name: 'users', component: () => import('@/pages/UsersView.vue'), meta: { title: 'کاربران' } },
      { path: 'audit-log', name: 'audit-log', component: () => import('@/pages/AuditLogView.vue'), meta: { title: 'تاریخچه اقدامات' } },
      { path: 'config', name: 'config', component: () => import('@/pages/ConfigView.vue'), meta: { title: 'تنظیمات پلتفرم' } },
```

- [ ] **Step 10: Full check and commit**

Run: `pnpm --filter @gheychi/admin-panel test` — expected: all suites pass (router guard suite included).
Run: `pnpm --filter @gheychi/admin-panel typecheck` — expected: clean.

```bash
git add apps/admin-panel/src/utils/slug-preview.ts apps/admin-panel/src/utils/slug-preview.spec.ts apps/admin-panel/src/pages/BlogEditorView.vue apps/admin-panel/src/pages/BlogEditorView.spec.ts apps/admin-panel/src/router/index.ts
git commit -m "feat(admin-panel): blog editor with live markdown preview, cover upload, and publish workflow"
```

---

### Task 12: User-app markdown renderer + public `/blog` index page

**Files:**
- Create: `apps/user-app/app/utils/markdown.ts`
- Create: `apps/user-app/app/pages/blog/index.vue`
- Modify: `apps/user-app/package.json` (via `pnpm add` — first user-app use of `markdown-it`)
- Modify: `apps/user-app/app/utils/types.ts`
- Test: `apps/user-app/test/unit/markdown.spec.ts` (create)
- Test: `apps/user-app/test/nuxt/blog-index.spec.ts` (create)

The user-app gets its own copy of the three-line `renderMarkdown` utility (identical config to the admin panel's; the two are pinned by separate invariant tests per the cross-app isolation convention) and the SSR blog index. List/filter state lives in the **route query** (`?category=<slug>&page=N`), so category chips and page turns are each a single `router.push` — the `useAsyncData` watcher sees one flush and refetches exactly once (no page-reset-then-load double fetch). The list load is silent with an inline empty state, matching the app's existing list pattern (`app/pages/index.vue` — the user-app has no `EmptyState` component; its empty states are inline markup).

Reminder: do **not** run `pnpm --filter @gheychi/user-app test:e2e` as part of this task's verification — the Playwright global-setup wipes the shared dev database.

- [ ] **Step 1: Write the failing invariant test (node env)**

```typescript
// apps/user-app/test/unit/markdown.spec.ts
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../app/utils/markdown'

describe('renderMarkdown (html:false invariant)', () => {
  it('renders markdown structure', () => {
    expect(renderMarkdown('# عنوان')).toContain('<h1>عنوان</h1>')
  })

  it('escapes a raw <script> payload instead of parsing it', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapes a raw <img onerror> payload instead of parsing it', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/user-app test -- test/unit/markdown.spec.ts`
Expected: FAIL — `Failed to resolve import "../../app/utils/markdown"` (file doesn't exist yet).

- [ ] **Step 3: Add the dependency and implement the utility**

Run (bare commands; check each exit code):

```bash
pnpm --filter @gheychi/user-app add markdown-it@^14.1.0
pnpm --filter @gheychi/user-app add -D @types/markdown-it@^14.1.2
```

```typescript
// apps/user-app/app/utils/markdown.ts
import MarkdownIt from 'markdown-it'

// html:false is the entire XSS story for blog content: raw HTML in the markdown source is
// escaped as text and never parses, which is what makes binding the output with v-html safe.
// Pinned by test/unit/markdown.spec.ts -- do not enable html without revisiting every v-html
// call site. Kept as the user-app's own copy (identical config to the admin panel's) per the
// cross-app isolation convention.
const md = new MarkdownIt({ html: false, linkify: true })

export function renderMarkdown(src: string): string {
  return md.render(src)
}
```

- [ ] **Step 4: Run the invariant test to verify it passes**

Run: `pnpm --filter @gheychi/user-app test -- test/unit/markdown.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the blog list types**

`apps/user-app/app/utils/types.ts` currently contains only `SearchResult`. Append (public list item fields exactly per the API's public blog list — no `bodyMarkdown` in lists):

```typescript
export interface BlogCategory {
  id: number
  name: string
  slug: string
}

export interface BlogPostListItem {
  id: string
  title: string
  slug: string
  excerpt: string | null
  coverImageUrl: string | null
  categoryName: string | null
  categorySlug: string | null
  authorName: string | null
  publishedAt: string
}

export interface BlogListResponse {
  items: BlogPostListItem[]
  total: number
  page: number
  pageSize: number
}
```

- [ ] **Step 6: Write the failing page spec (nuxt env)**

`$fetch` is stubbed directly (it's a real globalThis binding, not an unimport-tracked auto-import — same pattern as `booking-confirm.spec.ts`), dispatched by URL since the page makes two calls.

```typescript
// apps/user-app/test/nuxt/blog-index.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BlogIndexPage from '../../app/pages/blog/index.vue'

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const CATEGORIES = [{ id: 1, name: 'مراقبت مو', slug: 'hair' }]
const POST = {
  id: 'p1',
  title: 'ده نکته برای موی سالم',
  slug: 'healthy-hair-tips',
  excerpt: 'خلاصه مطلب',
  coverImageUrl: null,
  categoryName: 'مراقبت مو',
  categorySlug: 'hair',
  authorName: 'تیم آرایشگاه',
  publishedAt: '2026-07-01T08:00:00.000Z',
}

// Dispatch by URL -- the page fetches categories and the post list in the same setup.
function stubList(items: unknown[], total: number) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/blog/categories') return CATEGORIES
    if (path === '/blog/posts') return { items, total, page: 1, pageSize: 12 }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('blog index page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders post cards with category chip, byline, fa-IR date, and pagination', async () => {
    stubList([POST], 25)
    const wrapper = await mountSuspended(BlogIndexPage)

    expect(wrapper.text()).toContain('ده نکته برای موی سالم')
    expect(wrapper.text()).toContain('مراقبت مو')
    expect(wrapper.text()).toContain('تیم آرایشگاه')
    expect(wrapper.text()).toContain('۱۴۰۵') // fa-IR calendar year for 2026-07-01
    expect(wrapper.find(`a[href="/blog/${POST.slug}"]`).exists()).toBe(true)
    // 25 results at pageSize 12 -> pagination controls are visible
    expect(wrapper.find('[data-testid="next-page"]').exists()).toBe(true)
  })

  it('shows the empty state (and no pagination) when nothing is published', async () => {
    stubList([], 0)
    const wrapper = await mountSuspended(BlogIndexPage)

    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="next-page"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @gheychi/user-app test -- test/nuxt/blog-index.spec.ts`
Expected: FAIL — `Failed to resolve import "../../app/pages/blog/index.vue"` (page doesn't exist yet).

- [ ] **Step 8: Implement the blog index page**

```vue
<!-- apps/user-app/app/pages/blog/index.vue -->
<script setup lang="ts">
import type { BlogCategory, BlogListResponse } from '../../utils/types'

const route = useRoute()
const router = useRouter()
const { apiFetch } = useApi()

const PAGE_SIZE = 12

const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isInteger(n) && n > 0 ? n : 1
})
const categorySlug = computed(() => (typeof route.query.category === 'string' ? route.query.category : ''))

const { data: categories } = await useAsyncData('blog-categories', async () => {
  const { data } = await apiFetch<BlogCategory[]>('/blog/categories', { silent: true })
  return data ?? []
})

// Filter/page state lives in the route query, so a chip click or page turn is one
// router.push: both watched computeds change in the same flush and useAsyncData refetches
// exactly once (single-fetch idiom -- never the page-reset-then-load double-fetch form).
const { data: list } = await useAsyncData(
  'blog-posts',
  async () => {
    const { data } = await apiFetch<BlogListResponse>('/blog/posts', {
      query: {
        category: categorySlug.value || undefined,
        page: page.value,
        pageSize: PAGE_SIZE,
      },
      silent: true,
    })
    return data
  },
  { watch: [page, categorySlug] },
)

const totalPages = computed(() => (list.value ? Math.max(1, Math.ceil(list.value.total / list.value.pageSize)) : 1))

function selectCategory(slug: string) {
  // Switching category always lands on page 1 by dropping the page param entirely.
  router.push({ query: slug ? { category: slug } : {} })
}

function goToPage(target: number) {
  if (target < 1 || target > totalPages.value || target === page.value) return
  router.push({
    query: {
      ...(categorySlug.value ? { category: categorySlug.value } : {}),
      ...(target > 1 ? { page: target } : {}),
    },
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' })
}

useSeoMeta({
  title: 'بلاگ — راهنمای زیبایی و مراقبت',
  description: 'مقالات و راهنمای زیبایی، مو، پوست و ناخن از آرایشگاه',
})
</script>

<template>
  <div class="p-4 space-y-4">
    <h1 class="text-xl font-bold">بلاگ</h1>

    <div class="flex gap-2 overflow-x-auto">
      <button
        type="button"
        class="whitespace-nowrap rounded-full px-3 py-1 text-sm"
        :class="categorySlug === '' ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'"
        @click="selectCategory('')"
      >
        همه
      </button>
      <button
        v-for="cat in categories"
        :key="cat.id"
        type="button"
        class="whitespace-nowrap rounded-full px-3 py-1 text-sm"
        :class="categorySlug === cat.slug ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'"
        @click="selectCategory(cat.slug)"
      >
        {{ cat.name }}
      </button>
    </div>

    <p v-if="!list?.items?.length" data-testid="empty-state" class="py-10 text-center text-sm">
      مطلبی برای نمایش پیدا نشد
    </p>

    <div v-else class="grid gap-4 sm:grid-cols-2">
      <NuxtLink
        v-for="post in list.items"
        :key="post.id"
        :to="`/blog/${post.slug}`"
        class="overflow-hidden rounded-xl bg-(--color-surface-card)"
      >
        <NuxtImg
          v-if="post.coverImageUrl"
          provider="arvancloud"
          :src="post.coverImageUrl"
          width="400"
          height="225"
          loading="lazy"
          class="h-40 w-full object-cover"
          :alt="post.title"
        />
        <div v-else class="h-40 w-full bg-(--color-surface)" />
        <div class="space-y-1 p-3 text-sm">
          <p v-if="post.categoryName" class="text-xs text-(--color-accent)">{{ post.categoryName }}</p>
          <h2 class="font-bold">{{ post.title }}</h2>
          <p v-if="post.excerpt" class="line-clamp-2 opacity-80">{{ post.excerpt }}</p>
          <p class="text-xs opacity-60">
            <span v-if="post.authorName">{{ post.authorName }} · </span>
            <time :datetime="post.publishedAt">{{ formatDate(post.publishedAt) }}</time>
          </p>
        </div>
      </NuxtLink>
    </div>

    <nav v-if="totalPages > 1" class="flex items-center justify-center gap-3 pt-2 text-sm" aria-label="صفحه‌بندی">
      <button
        type="button"
        data-testid="prev-page"
        class="rounded-full bg-(--color-surface-card) px-3 py-1 disabled:opacity-40"
        :disabled="page <= 1"
        @click="goToPage(page - 1)"
      >
        قبلی
      </button>
      <span class="text-xs">صفحه {{ page.toLocaleString('fa-IR') }} از {{ totalPages.toLocaleString('fa-IR') }}</span>
      <button
        type="button"
        data-testid="next-page"
        class="rounded-full bg-(--color-surface-card) px-3 py-1 disabled:opacity-40"
        :disabled="page >= totalPages"
        @click="goToPage(page + 1)"
      >
        بعدی
      </button>
    </nav>
  </div>
</template>
```

- [ ] **Step 9: Run the page spec to verify it passes**

Run: `pnpm --filter @gheychi/user-app test -- test/nuxt/blog-index.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Full check and commit**

Run: `pnpm --filter @gheychi/user-app test` — expected: all unit + nuxt suites pass.
Run: `pnpm --filter @gheychi/user-app build` — expected: exit 0. (Do **not** gate on `pnpm --filter @gheychi/user-app typecheck` — it has a known pre-existing vite 7/6 Plugin-type conflict failure unrelated to this plan.)

```bash
git add apps/user-app/package.json pnpm-lock.yaml apps/user-app/app/utils/markdown.ts apps/user-app/test/unit/markdown.spec.ts apps/user-app/app/utils/types.ts apps/user-app/app/pages/blog/index.vue apps/user-app/test/nuxt/blog-index.spec.ts
git commit -m "feat(user-app): markdown renderer with html:false invariant and public blog index page"
```

---

### Task 13: `/blog/[slug]` article page — SEO meta, JSON-LD, RTL typography, public route + sitemap source

**Files:**
- Create: `apps/user-app/app/pages/blog/[slug].vue`
- Create: `apps/user-app/server/api/__sitemap__/blog.ts`
- Modify: `apps/user-app/app/utils/route-guard.ts` (:1-5 — whole file)
- Modify: `apps/user-app/nuxt.config.ts` (:15-17 — `sitemap.sources`)
- Test: `apps/user-app/test/unit/route-guard.spec.ts` (extend)
- Test: `apps/user-app/test/nuxt/blog-article.spec.ts` (create)

The article page follows `salons/[slug].vue` exactly for the not-found path: a silent `useAsyncData` fetch, then `throw createError({ statusCode: 404, ... })` when the API answered 404 (unpublished or unknown slug) — the app's standard 404. The body is rendered by `renderMarkdown` (Task 12's utility) bound with the sanctioned `v-html` inside a scoped `.article-body` block; since scoped styles don't reach `v-html` content directly, every inner selector goes through `:deep()`. The canonical URL is built from `useRequestURL().origin` (works on SSR and client alike; no new config key).

The sitemap side mirrors how the salons source works: one Nitro server route under `server/api/__sitemap__/` that fetches the API and maps to `SitemapUrlInput[]`, registered in `nuxt.config.ts`'s `sitemap.sources`. It consumes the API's `sitemap-blog.controller.ts` (this plan's backend sitemap task): `GET {apiBase}/sitemap/blog-posts` returning `{ slug: string; updatedAt: string }[]` for published posts, `lastmod` = `updated_at`.

Same reminder as Task 12: do not run the Playwright e2e suite as verification — its global-setup wipes the shared dev DB.

- [ ] **Step 1: Extend the route-guard unit spec (failing first)**

`apps/user-app/test/unit/route-guard.spec.ts` currently ends with the `/salons-archive` false-positive test (lines 20-22). Add two cases inside the same `describe`:

```typescript
  it('treats the blog index and articles as public', () => {
    expect(isPublicRoute('/blog')).toBe(true)
    expect(isPublicRoute('/blog/healthy-hair-tips')).toBe(true)
  })

  it('does not treat /blog-something-else as public (no false-positive prefix match)', () => {
    expect(isPublicRoute('/blog-archive')).toBe(false)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/user-app test -- test/unit/route-guard.spec.ts`
Expected: FAIL — `expected false to be true` (the `/blog` case; `isPublicRoute` doesn't know the prefix yet).

- [ ] **Step 3: Add the `/blog` prefix to `isPublicRoute`**

Replace the body of `apps/user-app/app/utils/route-guard.ts`:

```typescript
export function isPublicRoute(path: string): boolean {
  if (path === '/login') return true
  if (path === '/salons' || path.startsWith('/salons/')) return true
  if (path === '/blog' || path.startsWith('/blog/')) return true
  return false
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @gheychi/user-app test -- test/unit/route-guard.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing article-page spec (nuxt env)**

```typescript
// apps/user-app/test/nuxt/blog-article.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import BlogArticlePage from '../../app/pages/blog/[slug].vue'

// Same pattern as booking-confirm.spec.ts: $fetch is a real globalThis binding, stubbed
// directly; useRoute is pinned via mockNuxtImport so the page sees a fixed slug param.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

mockNuxtImport('useRoute', () => () => ({ params: { slug: 'healthy-hair-tips' }, query: {} }))

const ARTICLE = {
  id: 'p1',
  title: 'ده نکته برای موی سالم',
  slug: 'healthy-hair-tips',
  excerpt: 'خلاصه مطلب',
  bodyMarkdown: '## شستشوی درست\n\nمتن مقاله\n\n<script>alert(1)</script>',
  coverImageUrl: null,
  categoryName: 'مراقبت مو',
  categorySlug: 'hair',
  authorName: 'تیم آرایشگاه',
  metaDescription: null,
  ogTitle: null,
  publishedAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-02T08:00:00.000Z',
}

describe('blog article page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the article with markdown parsed, raw HTML escaped, byline and fa-IR date', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/blog/posts/healthy-hair-tips') return { ...ARTICLE }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(BlogArticlePage)

    expect(wrapper.get('h1').text()).toBe('ده نکته برای موی سالم')
    expect(wrapper.text()).toContain('تیم آرایشگاه')
    expect(wrapper.text()).toContain('۱۴۰۵') // fa-IR calendar year for 2026-07-01

    const body = wrapper.get('.article-body').element.innerHTML
    expect(body).toContain('<h2>شستشوی درست</h2>')
    expect(body).toContain('&lt;script&gt;')
    expect(body).not.toContain('<script>')

    // Category chip links back to the filtered index.
    expect(wrapper.find('a[href="/blog?category=hair"]').exists()).toBe(true)
  })

  it('throws the standard 404 for an unknown/unpublished slug', async () => {
    fetchMock.mockImplementation(async () => {
      // Shape matches how ofetch surfaces an HTTP error response.
      throw { response: { status: 404 } }
    })

    await expect(mountSuspended(BlogArticlePage)).rejects.toMatchObject({ statusCode: 404 })
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @gheychi/user-app test -- test/nuxt/blog-article.spec.ts`
Expected: FAIL — `Failed to resolve import "../../app/pages/blog/[slug].vue"` (page doesn't exist yet).

- [ ] **Step 7: Implement the article page**

```vue
<!-- apps/user-app/app/pages/blog/[slug].vue -->
<script setup lang="ts">
import { renderMarkdown } from '../../utils/markdown'

interface BlogArticle {
  id: string
  title: string
  slug: string
  excerpt: string | null
  bodyMarkdown: string
  coverImageUrl: string | null
  categoryName: string | null
  categorySlug: string | null
  authorName: string | null
  metaDescription: string | null
  ogTitle: string | null
  publishedAt: string
  updatedAt: string
}

const route = useRoute()
const slug = route.params.slug as string
const { apiFetch } = useApi()

const { data: post } = await useAsyncData(`blog-post-${slug}`, async () => {
  const { data } = await apiFetch<BlogArticle>(`/blog/posts/${slug}`, { silent: true })
  return data
})

if (!post.value) {
  // Unknown or unpublished slug -- the API answered 404; surface the app's standard 404
  // page exactly like salons/[slug].vue does.
  throw createError({ statusCode: 404, statusMessage: 'Post not found' })
}

const requestUrl = useRequestURL()
const canonicalUrl = `${requestUrl.origin}/blog/${post.value.slug}`

const seoTitle = post.value.ogTitle ?? post.value.title
const seoDescription = post.value.metaDescription ?? post.value.excerpt ?? undefined

useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: seoTitle,
  ogDescription: seoDescription,
  ogType: 'article',
  ogUrl: canonicalUrl,
  ogImage: post.value.coverImageUrl ?? undefined,
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl }],
  script: [
    {
      type: 'application/ld+json',
      // JSON.stringify drops undefined members, so optional fields simply vanish.
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: post.value.title,
        datePublished: post.value.publishedAt,
        dateModified: post.value.updatedAt,
        author: post.value.authorName ? { '@type': 'Person', name: post.value.authorName } : undefined,
        image: post.value.coverImageUrl ?? undefined,
      }),
    },
  ],
})

// Rendered once at setup -- the body never changes on this page.
const bodyHtml = renderMarkdown(post.value.bodyMarkdown)

const publishedDate = new Date(post.value.publishedAt).toLocaleDateString('fa-IR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
</script>

<template>
  <article class="mx-auto max-w-2xl space-y-5 p-4">
    <NuxtImg
      v-if="post!.coverImageUrl"
      provider="arvancloud"
      :src="post!.coverImageUrl"
      width="768"
      height="432"
      class="w-full rounded-xl object-cover"
      :alt="post!.title"
    />

    <div class="space-y-2">
      <NuxtLink
        v-if="post!.categorySlug"
        :to="{ path: '/blog', query: { category: post!.categorySlug } }"
        class="inline-block rounded-full bg-(--color-surface-card) px-3 py-1 text-xs text-(--color-accent)"
      >
        {{ post!.categoryName }}
      </NuxtLink>
      <h1 class="text-2xl font-bold leading-10">{{ post!.title }}</h1>
      <p class="text-xs opacity-70">
        <span v-if="post!.authorName">{{ post!.authorName }} · </span>
        <time :datetime="post!.publishedAt">{{ publishedDate }}</time>
      </p>
    </div>

    <!-- sanctioned v-html: renderMarkdown uses html:false so raw HTML never parses — see its invariant test -->
    <div class="article-body" v-html="bodyHtml" />
  </article>
</template>

<style scoped>
/* Hand-rolled RTL article typography -- Tailwind v4 here has no typography plugin, and
   scoped styles only reach v-html content through :deep(). Logical properties
   (padding-inline-start, border-inline-start) keep everything RTL-native, with explicit
   LTR islands for code. */
.article-body {
  font-size: 1rem;
  line-height: 1.9;
}
.article-body :deep(h1),
.article-body :deep(h2),
.article-body :deep(h3),
.article-body :deep(h4) {
  margin: 1.5em 0 0.5em;
  font-weight: 700;
  line-height: 1.5;
}
.article-body :deep(h1) { font-size: 1.5rem; }
.article-body :deep(h2) { font-size: 1.25rem; }
.article-body :deep(h3) { font-size: 1.1rem; }
.article-body :deep(p) { margin: 0.75em 0; }
.article-body :deep(ul),
.article-body :deep(ol) {
  margin: 0.75em 0;
  padding-inline-start: 1.5em;
}
.article-body :deep(ul) { list-style: disc; }
.article-body :deep(ol) { list-style: persian; }
.article-body :deep(li) { margin: 0.25em 0; }
.article-body :deep(blockquote) {
  margin: 1em 0;
  border-inline-start: 3px solid var(--color-accent);
  padding-inline-start: 1em;
  opacity: 0.85;
}
.article-body :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
}
.article-body :deep(img) {
  max-width: 100%;
  margin: 1em 0;
  border-radius: 0.75rem;
}
.article-body :deep(code) {
  direction: ltr;
  unicode-bidi: embed;
  font-family: ui-monospace, monospace;
  font-size: 0.875em;
  background: var(--color-surface-card);
  border-radius: 0.375rem;
  padding: 0.125em 0.375em;
}
.article-body :deep(pre) {
  direction: ltr;
  text-align: left;
  margin: 1em 0;
  padding: 1em;
  background: var(--color-surface-card);
  border-radius: 0.75rem;
  overflow-x: auto;
}
.article-body :deep(pre code) {
  background: none;
  padding: 0;
}
.article-body :deep(hr) {
  margin: 2em 0;
  border-color: var(--color-surface-card);
}
.article-body :deep(strong) { font-weight: 700; }
</style>
```

- [ ] **Step 8: Run the article spec to verify it passes**

Run: `pnpm --filter @gheychi/user-app test -- test/nuxt/blog-article.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Add the blog sitemap source**

Create the Nitro route (same shape and same h3-direct-import workaround as the existing `server/api/__sitemap__/urls.ts` — see the long comment there for why `defineEventHandler` is imported from h3 instead of using `defineSitemapEventHandler`):

```typescript
// apps/user-app/server/api/__sitemap__/blog.ts
import type { SitemapUrlInput } from '#sitemap/types'
import { defineEventHandler } from 'h3'

// Same h3-direct-import rationale as urls.ts (see the comment there): defineSitemapEventHandler
// is just defineEventHandler narrowed to return SitemapUrlInput[], and the app-side TS program
// can't see it. Consumes the API's sitemap-blog controller: published posts only, with
// updated_at as lastmod.
export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const posts = await $fetch<{ slug: string; updatedAt: string }[]>(`${config.public.apiBase}/sitemap/blog-posts`)

  return posts.map((post) => ({
    loc: `/blog/${post.slug}`,
    lastmod: post.updatedAt,
    changefreq: 'monthly',
    priority: 0.6,
  })) satisfies SitemapUrlInput[]
})
```

Then register it in `apps/user-app/nuxt.config.ts` — the `sitemap` block currently reads:

```typescript
  sitemap: {
    sources: ['/api/__sitemap__/urls'],
  },
```

Change it to:

```typescript
  sitemap: {
    sources: ['/api/__sitemap__/urls', '/api/__sitemap__/blog'],
  },
```

- [ ] **Step 10: Full check and commit**

Run: `pnpm --filter @gheychi/user-app test` — expected: all unit + nuxt suites pass.
Run: `pnpm --filter @gheychi/user-app build` — expected: exit 0 (this also compiles the new Nitro sitemap route). As in Task 12, do **not** gate on the user-app `typecheck` script (known pre-existing vite 7/6 Plugin-type conflict).

```bash
git add apps/user-app/app/pages/blog/[slug].vue apps/user-app/test/nuxt/blog-article.spec.ts apps/user-app/app/utils/route-guard.ts apps/user-app/test/unit/route-guard.spec.ts apps/user-app/server/api/__sitemap__/blog.ts apps/user-app/nuxt.config.ts
git commit -m "feat(user-app): blog article page with SEO meta and JSON-LD, public blog routes, blog sitemap source"
```

### Task 14: Docs update + final plan verification

**Files:**
- Modify: `CLAUDE.md` (:252 plans list; :269 the "Blog/content-marketing CMS … not-yet-started" bullet in "Known Gaps / Future Plans")
- Modify: `README.md` (:88 the stale "not-yet-started Plan 5" bullet inside the "User app (Plan 4)" section; new "Blog / content CMS (Plan 8)" section appended after Plan 7's)

Both files explicitly instruct readers to trust the Known Gaps list, and both currently say the blog CMS doesn't exist — Plan 8 makes that actively misleading. `README.md:88` is extra stale: it still calls the blog "Plan 5" from before the plan numbers were reassigned to provider-panel. Fix both, record what shipped and which cuts were deliberate, then run the full per-package verification sweep.

A note on the sweep before starting: every verification step below runs the **bare** command and gates on its exit code directly — do not pipe through `tee`/`tail`/`grep` (a pipe reports the *last* command's exit code, which would let a failing suite slip past the gate). No Playwright runs in this task (the frontend e2e global-setups **wipe and reseed the shared dev DB** — don't run them casually), and no `pnpm --filter @gheychi/user-app typecheck` — it has a known pre-existing failure (vite 7/6 `Plugin` type conflict) unrelated to this plan; the user-app gate is its Vitest suite plus `nuxt build`.

- [ ] **Step 1: Update `CLAUDE.md`'s plans list**

In the "Docs, Specs & Planning Workflow" section, replace:

```markdown
- `docs/superpowers/plans/` — the executed implementation plans, one per numbered plan (`plan-1-foundation-backend-core.md` through `plan-7-platform-hardening.md`, dated filenames like `2026-07-10-plan-7-platform-hardening.md`). These record what was actually built, including task-by-task completion notes and any deviations from the design doc.
```

with:

```markdown
- `docs/superpowers/plans/` — the executed implementation plans, one per numbered plan (`plan-1-foundation-backend-core.md` through `plan-8-blog-cms.md`, dated filenames like `2026-07-10-plan-8-blog-cms.md`). These record what was actually built, including task-by-task completion notes and any deviations from the design doc.
```

- [ ] **Step 2: Replace the blog bullet in `CLAUDE.md`'s "Known Gaps / Future Plans"**

The section's bullet order is: Plan 5/6 built → salon approval → photo upload → Plan 7 closures → three Plan 7 carried-forward gaps → blog CMS → refunds/alerting. Only the blog bullet changes. Replace:

```markdown
- **Blog/content-marketing CMS** is a separate, not-yet-started future plan (backend module + admin editor + public pages) — out of scope for every plan so far.
```

with:

```markdown
- **Blog/content CMS shipped in Plan 8.** A lean `apps/api/src/content/` module (posts + admin-managed categories, `draft` → `published` workflow with conditional-update race guards, cover images through the existing `StorageProvider`, a sitemap source for published articles), an admin-panel Markdown editor with live preview at `/blog`, and public SSR pages in the user-app at `/blog` and `/blog/[slug]`. **XSS safety is by construction:** posts store raw Markdown and both frontends render it through their own `markdown-it` utility configured `html: false`, so raw HTML never parses — each utility carries an invariant test pinning that, and the only two `v-html` bindings in the codebase (admin preview pane, user-app article body) are sanctioned solely by it. Deliberate cuts recorded in the spec (`docs/superpowers/specs/2026-07-10-plan-8-blog-cms-design.md`): no comments or reader interaction, no scheduled publishing, no RSS, no post revisions, and no redirects when a published post's slug changes (the editor warns that editing a published slug changes the URL; unpublish is the soft removal path).
```

- [ ] **Step 3: Fix the stale "not-yet-started Plan 5" line in `README.md`'s Plan 4 section**

The "Known gaps carried forward" list under "User app (Plan 4)" already uses the `~~…~~ Closed by Plan N` strikethrough convention for its first two bullets. Apply it to the third — replace:

```markdown
- Blog/content-marketing SEO is a separate, not-yet-started Plan 5 — this plan only covers the salon-profile side of SEO.
```

with:

```markdown
- ~~Blog/content-marketing SEO is a separate, not-yet-started Plan 5 — this plan only covers the salon-profile side of SEO.~~ Closed by Plan 8 (the plan numbering shifted after this was written — "Plan 5" became provider-panel): see "Blog / content CMS (Plan 8)" below.
```

- [ ] **Step 4: Append the "Blog / content CMS (Plan 8)" section to `README.md`**

Add at the very end of `README.md`, after the "Platform hardening (Plan 7)" section (its last line is the "Admin notifications are one shared queue…" bullet):

```markdown
## Blog / content CMS (Plan 8)

A Persian content-marketing blog: admins author Markdown articles in the admin panel, and the user-app serves them as SEO-optimized public pages that pull organic search traffic toward salon discovery. Spec: `docs/superpowers/specs/2026-07-10-plan-8-blog-cms-design.md`. This is the "backend module + admin editor + public pages" subsystem deferred since Plan 4.

**Authoring flow (admin panel, `/blog`):** create a draft («مطلب جدید») → edit in a Markdown editor with a live side-by-side preview — slug auto-generates from the title but stays editable, plus optional category, free-text byline, excerpt, per-post SEO overrides (meta description, og-title), and a cover image (uploaded through the same swappable `StorageProvider` as salon photos) → publish. Publishing stamps `published_at` on the *first* publish only; unpublish → republish keeps the original date. Publish/unpublish are conditional updates (`WHERE status='draft'`/`'published'`), so a lost race 409s instead of double-applying; delete is a hard delete of any status. Categories are managed in a side card on the same page. Every admin mutation writes an audit row (`post.create/update/publish/unpublish/delete/cover.set`, `blogcategory.create/update/delete`) via the Plan 7 audit seam.

Admin endpoints (all `@Roles('admin')`, all audited):

- `GET /api/admin/blog/posts?status&categoryId&page&pageSize` — `{items, total, page, pageSize}` envelope, items joined with category name; status defaults to all (admins manage everything)
- `GET /api/admin/blog/posts/:id` · `POST /api/admin/blog/posts` · `PATCH /api/admin/blog/posts/:id` · `DELETE /api/admin/blog/posts/:id`
- `POST /api/admin/blog/posts/:id/publish` · `POST /api/admin/blog/posts/:id/unpublish` — the conditional transitions above
- `POST /api/admin/blog/posts/:id/cover` (multipart, same size/type validation as salon photos; replaces and best-effort-deletes any previous cover object) · `DELETE /api/admin/blog/posts/:id/cover`
- `POST /api/admin/blog/categories` · `PATCH /api/admin/blog/categories/:id` · `DELETE /api/admin/blog/categories/:id` — delete restricts: a category referenced by any post 409s, same semantics as Plan 7's salon-service category delete

Public endpoints (no auth):

- `GET /api/blog/posts?category=<slug>&page&pageSize` — published only, `published_at DESC`, list items carry no article body
- `GET /api/blog/posts/:slug` — full article incl. `bodyMarkdown` and SEO fields; 404 unless published
- `GET /api/blog/categories`
- Published articles feed the user-app sitemap via a dedicated sitemap source, same mechanism as salon profile pages; cover images get public URLs the same way salon photos do.

User-app pages: `/blog` (SSR list — cover cards, category chips, pagination) and `/blog/[slug]` (SSR article with `useSeoMeta`, canonical URL, and JSON-LD `Article`). Both are public (unauthenticated) routes, joining `/salons/:slug` as the app's SEO surface.

**The `html: false` safety invariant.** Posts store raw Markdown; nothing is sanitized because nothing needs to be. Both frontends render through their own three-line `markdown-it` utility configured `{ html: false, linkify: true }`, so raw HTML in a post body never parses into DOM — `<script>alert(1)</script>` and `<img src=x onerror=…>` come out escaped/inert, and each app's utility has an invariant test pinning exactly that (a config regression fails CI). The rendered output is bound with `v-html` in exactly two places (admin editor preview, user-app article body), each commented as sanctioned solely by this invariant. Do not loosen `html: false` or add a third `v-html` site without re-deciding the whole model.

**Deliberate cuts, recorded in the spec — not bugs:** no comments, likes, or any reader interaction; no scheduled publishing (publish is manual, no cron); a single category per post (no tags), no post revisions/history, byline is free text (no author user accounts); no RSS/Atom, no in-blog search, no related-posts logic; no editorial roles beyond the existing single `admin` role; and no redirect table — changing a published post's slug (or hard-deleting a post) breaks previously indexed URLs, which is accepted for MVP (the editor hints at this; unpublish is the soft path).
```

- [ ] **Step 5: Verify — API unit suite**

From the repo root (`~/projects/Gheychi`), run bare:

```bash
pnpm --filter @gheychi/api test
```

Expected: exit code 0 — all Jest units pass, including this plan's colocated `content.service.spec.ts`, `slug.util.spec.ts` (moved to `src/common/`), DTO specs, and the extended `audit-wiring.spec.ts` (36 tests / 18 wiring cases).

- [ ] **Step 6: Verify — API e2e**

Needs the docker services already running and migrations applied — both have been true throughout this plan; if this is a fresh shell, nothing new is required.

```bash
pnpm --filter @gheychi/api test:e2e
```

Expected: exit code 0 — including the blog lifecycle spec (draft → publish → public list/slug/sitemap → unpublish → 404 → delete), category restrict-delete, cover upload/replace/delete, and audit rows for each admin mutation.

- [ ] **Step 7: Verify — admin-panel Vitest suite**

```bash
pnpm --filter @gheychi/admin-panel test
```

Expected: exit code 0 — including the BlogPostsView/BlogEditorView specs, the markdown invariant test, and the updated `AUDIT_ACTION_KEYS` length guard (now 18).

- [ ] **Step 8: Verify — user-app Vitest suite**

```bash
pnpm --filter @gheychi/user-app test
```

Expected: exit code 0 — including the user-app markdown invariant test and the blog page/component specs. (Do **not** run `pnpm --filter @gheychi/user-app typecheck` — known pre-existing vite 7/6 `Plugin` type conflict, unrelated to this plan; tests + build are the gate.)

- [ ] **Step 9: Verify — provider-panel Vitest suite**

Provider-panel is untouched by Plan 8; this is the cheap cross-app regression check (shared repo, shared lockfile).

```bash
pnpm --filter @gheychi/provider-panel test
```

Expected: exit code 0, unchanged pass count.

- [ ] **Step 10: Verify — API build**

```bash
pnpm --filter @gheychi/api build
```

Expected: exit code 0 (`nest build` compiles the new content module cleanly).

- [ ] **Step 11: Verify — admin-panel build**

```bash
pnpm --filter @gheychi/admin-panel build
```

Expected: exit code 0 — this runs `vue-tsc -b && vite build`, so it is also the admin-panel type gate for the new views, labels, and icon.

- [ ] **Step 12: Verify — user-app build**

```bash
pnpm --filter @gheychi/user-app build
```

Expected: exit code 0 (`nuxt build` — this, not the broken `typecheck` script, is the user-app compilation gate).

- [ ] **Step 13: Commit the docs**

```bash
git add CLAUDE.md README.md
git commit -m "docs: record Plan 8 blog CMS in CLAUDE.md and README"
```


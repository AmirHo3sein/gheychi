# Plan 8: Blog / Content-Marketing CMS

**Date:** 2026-07-10
**Status:** Approved
**Depends on:** Plans 1–7 (all shipped). Reuses Plan 7's audit seam and Plan 5's StorageProvider.

## 1. Product Summary

A lean blog for content marketing: admins write Persian articles in the admin panel, and the user-app serves them as SEO-optimized public pages that pull organic search traffic toward salon discovery. This is the "backend module + admin editor + public pages" subsystem deferred since Plan 4.

### Decisions locked during brainstorming

- **Markdown authoring** with a live preview in the admin panel — not WYSIWYG, not plain fields.
- **Post model:** cover image (StorageProvider), admin-managed categories, free-text author byline, per-post SEO overrides (meta description, og-title).
- **Workflow:** `draft` → `published`, unpublish anytime, publish stamps `published_at`. No scheduled publishing (deliberate cut).
- **Architecture:** custom lean NestJS content module on existing conventions — no headless CMS, no file-based content.
- **XSS-safe by construction:** posts store raw Markdown; both frontends render with `markdown-it` configured `html: false`, so raw HTML never parses. No sanitizer dependency.

## 2. Schema (one migration)

```sql
CREATE TABLE blog_categories (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(60) NOT NULL UNIQUE,
  slug varchar(80) NOT NULL UNIQUE
);

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
);
CREATE INDEX blog_posts_public_idx ON blog_posts (status, published_at DESC);
CREATE INDEX blog_posts_category_idx ON blog_posts (category_id);
```

Entities follow repo convention: explicit snake_case `@Column({ name })`, no relation decorators, FKs only in migration SQL. `updated_at` maintained by `@UpdateDateColumn`.

## 3. Backend (`apps/api/src/content/`)

### 3.1 Module layout

```
src/content/
├── content.module.ts
├── blog-post.entity.ts          blog-category.entity.ts
├── content.service.ts           # post CRUD + publish transitions + public queries
├── admin-blog.controller.ts     # /admin/blog/* (posts + categories)
├── blog.controller.ts           # public /blog/*
├── sitemap-blog.controller.ts   # sitemap source for /blog/<slug>
└── dto/blog.dto.ts
```

### 3.2 Slug generation

Reuse the existing slug utility from the salons module. If it is salon-specific, move it to `src/common/slug.util.ts` (with its spec) and re-export/import from both call sites — a targeted improvement, not a refactor. Slugs auto-generate from the title on create, remain editable via PATCH, and uniqueness is enforced by the DB (23505 → 409 «این نامک قبلاً استفاده شده است»).

### 3.3 Admin endpoints (AuthGuard + RolesGuard + @Roles('admin'); every mutation audited)

Posts:
- `GET /api/admin/blog/posts?status&categoryId&page&pageSize` — `{items, total, page, pageSize}` envelope (status defaults to `all` here — admins manage everything), items joined with category name.
- `GET /api/admin/blog/posts/:id` — full post for the editor.
- `POST /api/admin/blog/posts` — create draft (title required; slug auto). `@AuditAction('post.create', 'post')`.
- `PATCH /api/admin/blog/posts/:id` — edit any content/SEO field incl. slug. `@AuditAction('post.update', 'post')`.
- `POST /api/admin/blog/posts/:id/publish` — conditional update `WHERE status='draft'`, stamps `published_at` (first publish only; republish keeps the original date), 409 on race. `@AuditAction('post.publish', 'post')`.
- `POST /api/admin/blog/posts/:id/unpublish` — conditional `WHERE status='published'`, 409 on race; `published_at` kept. `@AuditAction('post.unpublish', 'post')`.
- `DELETE /api/admin/blog/posts/:id` — hard delete (any status), 204/404. Deletes the cover object best-effort. `@AuditAction('post.delete', 'post')`.
- `POST /api/admin/blog/posts/:id/cover` — multipart upload via `StorageProvider` (same pattern as salon photos: size/type validation, stores key, replaces existing cover, deletes the old object best-effort). `@AuditAction('post.cover.set', 'post')`.
- `DELETE /api/admin/blog/posts/:id/cover` — clears the key, deletes the object best-effort. `@AuditAction('post.cover.set', 'post')` (same action; payload disambiguates).

Categories:
- `POST /api/admin/blog/categories` — `@AuditAction('blogcategory.create', 'blogcategory')`; 409 duplicate name.
- `PATCH /api/admin/blog/categories/:id` — rename (slug regenerates unless provided). `@AuditAction('blogcategory.update', 'blogcategory')`.
- `DELETE /api/admin/blog/categories/:id` — restrict: 23503 → 409 «این دسته‌بندی دارای مطلب است و قابل حذف نیست». `@AuditAction('blogcategory.delete', 'blogcategory')`.

The nine new action strings (six `post.*`, three `blogcategory.*`) join the admin-panel `AUDIT_ACTION` map; its `AUDIT_ACTION_KEYS` length-guard test forces the deliberate update (by design from Plan 7).

### 3.4 Public endpoints (no auth)

- `GET /api/blog/posts?category=<slug>&page&pageSize` — published only, `published_at DESC`, envelope; items carry title/slug/excerpt/coverImageUrl/categoryName/categorySlug/authorName/publishedAt (no body).
- `GET /api/blog/posts/:slug` — published only (404 otherwise); full post incl. `bodyMarkdown` and SEO fields.
- `GET /api/blog/categories` — id/name/slug list.
- Cover images are served the same way salon photos are (public URL derived from the storage key via the existing mechanism).

### 3.5 Sitemap

`sitemap-blog.controller.ts` exposes the blog URL set in the same format `sitemap-salons.controller.ts` uses (published posts only, `lastmod` = `updated_at`). The user-app's `nuxt.config.ts` `sitemap.sources` array gains the new source URL.

## 4. Frontend

### 4.1 Admin panel

- **`/blog` (BlogPostsView):** standard list recipe — status filter (`all|draft|published`), category filter, Pagination; rows show title, category, status badge (`draft`→neutral «پیش‌نویس», `published`→success «منتشرشده» in `labels.ts`), publish date; row click → editor. «مطلب جدید» button → editor in create mode. Categories managed in a side card on the same page (CategoriesView pattern incl. restrict-delete confirm).
- **`/blog/:id` + `/blog/new` (BlogEditorView):** title, slug (auto-filled from title until manually edited), category AppSelect, author, excerpt, collapsible SEO section (meta description with counter, og-title), cover upload with preview + remove, Markdown textarea with a live side-by-side preview pane (rendered by the admin panel's own `markdown-it` utility, `html: false`), character-count hints. Actions: save (create/PATCH), publish, unpublish, delete-with-inline-confirm — all with re-entry guards; failures collapse confirm state and reload per the Plan 7 house rules.
- Nav entry «بلاگ» with a new `newspaper` icon in AppIcon.
- All user text rendered via `{{ }}` only; the preview pane renders markdown-it output via `v-html` **only because** the renderer is configured `html: false` — this is the single sanctioned `v-html` in the app, with a comment stating the invariant.

### 4.2 User app

- **`/blog` (index):** SSR list of published posts — cover cards (through `@nuxt/image` where applicable), category chips filtering via query param, pagination. Empty state.
- **`/blog/[slug]`:** SSR article — cover, category link, byline, fa-IR date, Markdown body rendered by the user-app's own `markdown-it` utility (`html: false`, same sanctioned-`v-html` invariant), hand-rolled RTL article typography (a scoped `.article-body` style block; Tailwind v4 has no typography plugin here).
- **SEO:** `useSeoMeta` per page — title (og-title override when set), description (meta_description ?? excerpt), canonical URL, og:image from the cover; JSON-LD `Article` script (headline, datePublished, dateModified, author, image).
- `/blog` prefix joins `isPublicRoute()` in `app/utils/route-guard.ts`.
- 404 handling: unknown slug → the app's standard 404 path.

## 5. Error Handling

- Nest built-ins only: 404 missing/unpublished, 409 slug or category-name conflict (23505 helper), 409 category-in-use delete (23503 helper), 409 publish/unpublish lost races (conditional updates), 400 via DTO validation.
- Upload validation mirrors salon photos (type/size limits, same error surface).
- Frontend failures follow the established policies (toast via useApi defaults; silent list loads with EmptyState).

## 6. Testing

- **API unit (colocated):** content.service (publish/unpublish transition matrix incl. republish keeping `published_at`, slug conflict translation, category restrict), slug util (if moved), DTO edges.
- **API e2e:** blog lifecycle (create draft → not public → publish → public list + by-slug + sitemap → unpublish → 404 + out of sitemap → delete), category restrict-delete 409, cover upload/replace/delete, audit rows for each admin mutation.
- **Admin panel (Vitest):** editor (preview renders markdown, no raw-HTML passthrough — test that `<script>` in markdown comes out escaped/inert), list recipe, publish/unpublish actions with race handling, category delete confirm.
- **User app (Vitest):** markdown render utility (html:false invariant test), blog card + article page components (nuxt env).
- No Playwright additions; frontend e2e reminder: global-setups wipe the shared dev DB.

## 7. Out of Scope (deliberate)

- Comments, likes, or any reader interaction.
- Scheduled publishing (no cron; publish is manual).
- Tags beyond the single category, post revisions/history, multi-author user accounts (byline is free text).
- RSS/Atom feeds, in-blog search, related-posts logic.
- Editorial roles/permissions beyond the existing single `admin` role.

## 8. Open Risks

- **`v-html` for rendered markdown** is safe only while `html: false` holds in both render utilities — each utility carries a test pinning that a raw-HTML/script payload comes out inert, so a config regression fails CI.
- **Slug changes after publish** break previously indexed URLs (no redirect table — accepted; admins are told via a hint in the editor that changing a published slug changes the URL). The same applies to category slugs: renaming a category without pinning its slug regenerates it, changing `/blog?category=<slug>` URLs — same accepted risk, same escape hatch (provide the slug explicitly).
- **Two markdown-it copies** (admin-panel preview, user-app render) can drift in config; both configs are three lines and each is pinned by its own invariant test — accepted per the cross-app isolation convention.
- **Hard delete of published posts** removes public URLs without redirects — accepted for MVP (unpublish is the soft path).

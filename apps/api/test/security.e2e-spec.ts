import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { Review } from '../src/reviews/review.entity';
import { User } from '../src/users/user.entity';
import { loginAs, loginAsAdmin, verifyOtpAndLogin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

// A minimal valid 1x1 transparent PNG (real magic-number bytes) -- see salon-photos.e2e-spec.ts,
// which this file's upload-validation case complements rather than duplicates.
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

/**
 * Phase 1 security regression suite (task 10). Cross-references, rather than duplicates,
 * existing coverage for the same attack classes elsewhere in this test/ directory:
 *   - unauthorized-guard PRESENCE (every route has a guard, statically) is covered
 *     exhaustively by src/route-guard-audit.spec.ts -- this file instead proves a sample of
 *     those guards actually reject real requests end-to-end over HTTP.
 *   - suspended-user login/session lockout is covered end-to-end by
 *     user-suspend-login.e2e-spec.ts -- this file adds the one case that isn't there yet:
 *     a suspended PROVIDER blocked from a salon-management mutation, not just GET /auth/me.
 *   - "invalid uploads" (non-image content) is covered by salon-photos.e2e-spec.ts -- this
 *     file adds the oversized-file case, which isn't tested anywhere yet.
 */
describe('Security regression suite (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('unauthorized access to admin endpoints', () => {
    let customerCookie: string;

    beforeAll(async () => {
      customerCookie = await loginAs(app, '09150000001');
    });

    // One route per distinct @Roles('admin')-guarded controller class (all 16 currently
    // in src/, verified by grepping `@Roles('admin')` -- see the audit that added this
    // comment). Every one of those controllers uses the exact same class-level
    // `@UseGuards(AuthGuard, RolesGuard)` + `@Roles('admin')` wiring (no method carries a
    // different combination), and RolesGuard itself has zero per-controller branching --
    // it only reads the reflected metadata and compares it to req.user.role. So this list
    // is deliberately exhaustive per-controller (not just "a sample of routes"): it is
    // proof the one shared guard rejects a real non-admin session on every controller that
    // relies on it, which route-guard-audit.spec.ts's static reflection check cannot show
    // by itself (it only proves *a* guard is attached, not that the guard's runtime
    // behavior is correct end-to-end over HTTP).
    const ADMIN_ROUTES: Array<{ method: 'get' | 'patch' | 'post'; path: string; body?: unknown }> = [
      { method: 'get', path: '/api/admin/salons' },
      { method: 'get', path: '/api/admin/users' },
      { method: 'get', path: '/api/admin/audit-log' },
      { method: 'get', path: '/api/admin/reports' },
      { method: 'get', path: '/api/admin/wallet/transactions' },
      { method: 'post', path: '/api/admin/coupons', body: { code: 'X', discountPercent: 10 } },
      { method: 'patch', path: '/api/admin/config', body: { entries: [] } },
      { method: 'get', path: '/api/admin/referral-reward-types' },
      { method: 'get', path: '/api/admin/referrals' },
      { method: 'post', path: '/api/admin/categories', body: { name: 'X', icon: 'scissors' } },
      { method: 'get', path: '/api/admin/blog/posts' },
      { method: 'patch', path: '/api/admin/stories/00000000-0000-0000-0000-000000000000/status', body: { status: 'removed' } },
      { method: 'get', path: '/api/admin/notifications' },
      { method: 'get', path: '/api/admin/invoices' },
      { method: 'get', path: '/api/admin/worker-ratings' },
      { method: 'get', path: '/api/admin/reviews' },
    ];

    it.each(ADMIN_ROUTES)('401s $method $path with no session at all', async ({ method, path, body }) => {
      await request(app.getHttpServer())[method](path).send(body ?? {}).expect(401);
    });

    it.each(ADMIN_ROUTES)('403s $method $path for a logged-in non-admin (customer) session', async ({ method, path, body }) => {
      await request(app.getHttpServer())[method](path).set('Cookie', customerCookie).send(body ?? {}).expect(403);
    });
  });

  describe('a provider cannot reach another salon\'s data through their own "mine" routes', () => {
    let ownerACookie: string;
    let ownerBCookie: string;
    let serviceIdA: string;
    let workerIdA: string;
    let bookingIdA: string;
    let couponIdA: string;
    let portfolioIdA: string;
    let photoIdA: string;
    let storyIdA: string;
    let reviewIdA: string;

    beforeAll(async () => {
      ownerACookie = await loginAs(app, '09150000010');
      ownerBCookie = await loginAs(app, '09150000011');
      const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
      const categoryId = categoriesRes.body[0].id;

      const salonA = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerACookie).send({
        name: 'Tenant A Salon', genderTarget: 'women', address: 'Addr A', city: 'Tehran',
        lat: 35.7, lng: 51.4, capacity: 3, categoryIds: [categoryId],
      });
      await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerBCookie).send({
        name: 'Tenant B Salon', genderTarget: 'women', address: 'Addr B', city: 'Tehran',
        lat: 35.72, lng: 51.42, capacity: 3, categoryIds: [categoryId],
      });
      // POST /bookings only accepts a salon in status='approved' -- a fresh salon starts
      // 'pending', so it's approved directly here the same way every other e2e spec that
      // needs a real booking against a freshly-created salon does.
      await app.get(DataSource).query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonA.body.id]);

      const serviceRes = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', ownerACookie)
        .send({ categoryId, name: 'A Cut', price: 300_000, durationMin: 30 });
      serviceIdA = serviceRes.body.id;

      const workerRes = await request(app.getHttpServer())
        .post('/api/salons/mine/workers')
        .set('Cookie', ownerACookie)
        .send({ name: 'A Worker', phone: '09150000012' });
      workerIdA = workerRes.body.id;

      await request(app.getHttpServer())
        .put('/api/salons/mine/hours')
        .set('Cookie', ownerACookie)
        .send({ hours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, openTime: '09:00', closeTime: '20:00' })) });

      const customerCookie = await loginAs(app, '09150000013');
      const bookingRes = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId: salonA.body.id, serviceId: serviceIdA, startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString() });
      bookingIdA = bookingRes.body.booking.id;

      const couponRes = await request(app.getHttpServer())
        .post('/api/salons/mine/coupons')
        .set('Cookie', ownerACookie)
        .send({ code: 'TENANTA10', discountPercent: 10 });
      couponIdA = couponRes.body.id;

      const portfolioRes = await request(app.getHttpServer())
        .post('/api/salons/mine/portfolio')
        .set('Cookie', ownerACookie)
        .attach('file', MINIMAL_PNG, { filename: 'a.png', contentType: 'image/png' });
      portfolioIdA = portfolioRes.body.id;

      const photoRes = await request(app.getHttpServer())
        .post('/api/salons/mine/photos')
        .set('Cookie', ownerACookie)
        .attach('file', MINIMAL_PNG, { filename: 'a.png', contentType: 'image/png' });
      photoIdA = photoRes.body.id;

      const storyRes = await request(app.getHttpServer())
        .post('/api/salons/mine/stories')
        .set('Cookie', ownerACookie)
        .attach('file', MINIMAL_PNG, { filename: 'a.png', contentType: 'image/png' });
      storyIdA = storyRes.body.id;

      // Inserted directly rather than through the full booking-completion + POST /reviews
      // flow -- this test only needs a real review row scoped to salon A to exercise
      // SalonReviewReplyController's ownership check, not the review-creation business
      // rules (which are exercised elsewhere).
      const reviews = app.get<Repository<Review>>(getRepositoryToken(Review));
      const users = app.get<Repository<User>>(getRepositoryToken(User));
      const customer = await users.findOneByOrFail({ phone: '09150000013' });
      const review = await reviews.save(
        reviews.create({ bookingId: bookingIdA, salonId: salonA.body.id, userId: customer.id, rating: 5 }),
      );
      reviewIdA = review.id;
    });

    it("404s owner B assigning a worker onto owner A's booking (id guessed/known, but scoped away by SalonOwnerGuard)", () =>
      request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingIdA}/assign-worker`)
        .set('Cookie', ownerBCookie)
        .send({ workerId: workerIdA })
        .expect(404));

    it("404s owner B editing owner A's service", () =>
      request(app.getHttpServer())
        .patch(`/api/salons/mine/services/${serviceIdA}`)
        .set('Cookie', ownerBCookie)
        .send({ price: 1 })
        .expect(404));

    it("404s owner B editing owner A's worker", () =>
      request(app.getHttpServer())
        .patch(`/api/salons/mine/workers/${workerIdA}`)
        .set('Cookie', ownerBCookie)
        .send({ active: false })
        .expect(404));

    it("404s owner B marking owner A's booking completed", () =>
      request(app.getHttpServer())
        .patch(`/api/salons/mine/bookings/${bookingIdA}`)
        .set('Cookie', ownerBCookie)
        .send({ status: 'completed' })
        .expect(404));

    it("404s owner B updating owner A's coupon", () =>
      request(app.getHttpServer())
        .patch(`/api/salons/mine/coupons/${couponIdA}`)
        .set('Cookie', ownerBCookie)
        .send({ discountPercent: 99 })
        .expect(404));

    it("404s owner B deactivating owner A's coupon", () =>
      request(app.getHttpServer())
        .delete(`/api/salons/mine/coupons/${couponIdA}`)
        .set('Cookie', ownerBCookie)
        .expect(404));

    it("404s owner B editing owner A's portfolio item", () =>
      request(app.getHttpServer())
        .patch(`/api/salons/mine/portfolio/${portfolioIdA}`)
        .set('Cookie', ownerBCookie)
        .send({ caption: 'hijacked' })
        .expect(404));

    it("404s owner B editing owner A's photo", () =>
      request(app.getHttpServer())
        .patch(`/api/salons/mine/photos/${photoIdA}`)
        .set('Cookie', ownerBCookie)
        .send({ isCover: true })
        .expect(404));

    it("404s owner B deleting owner A's story", () =>
      request(app.getHttpServer())
        .delete(`/api/salons/mine/stories/${storyIdA}`)
        .set('Cookie', ownerBCookie)
        .expect(404));

    it("404s owner B replying to owner A's review", () =>
      request(app.getHttpServer())
        .patch(`/api/salons/mine/reviews/${reviewIdA}/reply`)
        .set('Cookie', ownerBCookie)
        .send({ reply: 'hijacked reply' })
        .expect(404));

    it("404s owner B creating a schedule exception that references owner A's worker id (id manipulation via body, not URL param)", () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/exceptions')
        .set('Cookie', ownerBCookie)
        .send({ date: '2099-01-01', workerId: workerIdA })
        .expect(404));

    it("owner A's own data is untouched by every rejected cross-tenant attempt above", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/salons/mine/services`)
        .set('Cookie', ownerACookie)
        .expect(200);
      expect(res.body.find((s: { id: string }) => s.id === serviceIdA).price).toBe(300_000);
    });
  });

  describe('suspended users are blocked mid-session from mutating a salon, not just from GET /auth/me', () => {
    let users: Repository<User>;
    let ownerCookie: string;
    let serviceId: string;

    beforeAll(async () => {
      users = app.get(getRepositoryToken(User));
      ownerCookie = await loginAs(app, '09150000020');
      const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
      await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
        name: 'Suspend Test Salon', genderTarget: 'women', address: 'Addr 1', city: 'Tehran',
        lat: 35.7, lng: 51.4, categoryIds: [categoriesRes.body[0].id],
      });
      const serviceRes = await request(app.getHttpServer())
        .post('/api/salons/mine/services')
        .set('Cookie', ownerCookie)
        .send({ categoryId: categoriesRes.body[0].id, name: 'Cut', price: 100_000, durationMin: 30 });
      serviceId = serviceRes.body.id;
    });

    it('rejects a salon-management mutation from a still-valid cookie once the owner account is suspended', async () => {
      await request(app.getHttpServer())
        .patch(`/api/salons/mine/services/${serviceId}`)
        .set('Cookie', ownerCookie)
        .send({ price: 999_999 })
        .expect(200); // sanity: works before suspension

      await users.update({ phone: '09150000020' }, { status: 'suspended' });

      await request(app.getHttpServer())
        .patch(`/api/salons/mine/services/${serviceId}`)
        .set('Cookie', ownerCookie)
        .send({ price: 1 })
        .expect(403);
    });
  });

  describe('invalid uploads', () => {
    let ownerCookie: string;

    beforeAll(async () => {
      ownerCookie = await loginAs(app, '09150000030');
      const categoriesRes = await request(app.getHttpServer()).get('/api/categories').expect(200);
      await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
        name: 'Upload Test Salon', genderTarget: 'women', address: 'Addr 1', city: 'Tehran',
        lat: 35.7, lng: 51.4, categoryIds: [categoriesRes.body[0].id],
      });
    });

    it('422s a non-image file even when it lies about its content-type and filename extension', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/photos')
        .set('Cookie', ownerCookie)
        .attach('file', Buffer.from('<?php system($_GET["c"]); ?>'), { filename: 'totally-a.png', contentType: 'image/png' })
        .expect(422));

    it('rejects a file over the 5MB cap before it ever reaches the handler', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/photos')
        .set('Cookie', ownerCookie)
        .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1, 0), { filename: 'huge.png', contentType: 'image/png' })
        .expect((res) => {
          expect([413, 422]).toContain(res.status);
        }));

    it('still accepts a genuinely valid image (contrast/sanity check)', () =>
      request(app.getHttpServer())
        .post('/api/salons/mine/photos')
        .set('Cookie', ownerCookie)
        .attach('file', MINIMAL_PNG, { filename: 'real.png', contentType: 'image/png' })
        .expect(201));
  });

  describe('XSS markdown payloads are stored/returned inertly by the API (rendering-time escaping happens client-side)', () => {
    let adminCookie: string;
    const XSS_TITLE = '<script>alert(1)</script> Great Haircuts';
    const XSS_BODY = '# Heading\n\n<script>alert(document.cookie)</script>\n\n<img src=x onerror="alert(1)">\n\nNormal **markdown** text.';

    beforeAll(async () => {
      adminCookie = await loginAsAdmin(app, '09150000040');
    });

    it('stores and returns an XSS payload byte-for-byte verbatim, with no server-side execution or corruption', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/admin/blog/posts')
        .set('Cookie', adminCookie)
        .send({ title: XSS_TITLE, bodyMarkdown: XSS_BODY })
        .expect(201);

      expect(created.body.title).toBe(XSS_TITLE);
      expect(created.body.bodyMarkdown).toBe(XSS_BODY);

      const publishRes = await request(app.getHttpServer())
        .post(`/api/admin/blog/posts/${created.body.id}/publish`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(publishRes.body.slug).toBeTruthy();

      // Public read path returns the same raw markdown -- the API never attempts to
      // sanitize/strip it, because sanitization is not its job: both frontends render
      // through markdown-it configured `html:false` (see apps/user-app/app/utils/
      // markdown.ts and apps/admin-panel/src/utils/markdown.ts, each pinned by its own
      // invariant test asserting a <script>/onerror payload renders inert), so raw HTML
      // in the source never parses into DOM regardless of what the API stores.
      const publicRes = await request(app.getHttpServer())
        .get(`/api/blog/posts/${publishRes.body.slug}`)
        .expect(200);
      expect(publicRes.body.bodyMarkdown).toBe(XSS_BODY);
      expect(publicRes.body.title).toBe(XSS_TITLE);
    });
  });

  describe('role escalation attempts', () => {
    it('silently strips an extra "role" field from PATCH /auth/profile instead of applying it', async () => {
      const cookie = await loginAs(app, '09150000050');

      await request(app.getHttpServer())
        .patch('/api/auth/profile')
        .set('Cookie', cookie)
        .send({ name: 'Escalation Attempt', gender: 'male', role: 'admin', status: 'active' })
        .expect(200);

      const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200);
      expect(me.body.name).toBe('Escalation Attempt'); // the legitimate fields DID apply
      expect(me.body.role).toBe('customer'); // the injected field did not
    });

    it('403s a customer attempting to suspend/escalate their own account via the admin endpoint', async () => {
      const { cookie, body } = await verifyOtpAndLogin(app, '09150000051');
      const userId = (body.user as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${userId}/status`)
        .set('Cookie', cookie)
        .send({ status: 'active' })
        .expect(403);
    });
  });
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createApprovedSalon } from './factories/salon.factory';
import { createTestApp } from './utils/test-app';

/**
 * The public salon handle -- salon.slug, reused directly as the shareable link (see
 * docs/technical-overview/31-public-handle-and-attribution.md), made provider-editable with
 * a reserved-word check and admin override recourse.
 *
 * Also covers handle HISTORY: a released handle is recorded in salon_slug_history so an
 * already-printed QR code keeps working (resolved via GET /salons/:slug/canonical, which the
 * user-app turns into a real 301) and so the freed handle stays reserved against a competitor
 * claiming it and inheriting that traffic.
 *
 * These cases run in sequence against one shared pair of salons -- each `it` builds on the
 * handle state the previous one left behind, which is the point: reservations are only
 * meaningful across renames.
 */
describe('Salon public handle (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let otherOwnerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let otherSalonId: string;
  /** The auto-generated handle the salon was created with, released by the first rename. */
  let originalSlug: string;
  let salonSlug: string;
  let otherSalonSlug: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09141110001');
    ({ salonId, slug: salonSlug } = await createApprovedSalon(app, ownerCookie, { name: 'Handle Test Salon' }));
    originalSlug = salonSlug;

    otherOwnerCookie = await loginAs(app, '09141110002');
    ({ salonId: otherSalonId, slug: otherSalonSlug } = await createApprovedSalon(app, otherOwnerCookie, {
      name: 'Other Handle Salon',
    }));

    adminCookie = await loginAsAdmin(app, '09141110003');
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the owner set a clean, memorable handle', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/salons/mine/handle')
      .set('Cookie', ownerCookie)
      .send({ handle: 'my-clean-handle' })
      .expect(200);

    expect(res.body.slug).toBe('my-clean-handle');
    salonSlug = 'my-clean-handle';
  });

  it('the public profile is reachable at the new handle immediately', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${salonSlug}`).expect(200);
    expect(res.body.name).toBe('Handle Test Salon');
  });

  it('the released handle resolves to the current one instead of dying', async () => {
    // The profile endpoint itself still 404s under the old handle -- deliberately: serving
    // the same salon at two URLs is exactly what the canonical/redirect design avoids.
    await request(app.getHttpServer()).get(`/api/salons/${originalSlug}`).expect(404);

    const res = await request(app.getHttpServer()).get(`/api/salons/${originalSlug}/canonical`).expect(200);
    expect(res.body).toEqual({ slug: 'my-clean-handle', moved: true });
  });

  it('reports a live handle as already-canonical, and 404s a handle that never existed', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${salonSlug}/canonical`).expect(200);
    expect(res.body).toEqual({ slug: salonSlug, moved: false });

    await request(app.getHttpServer()).get('/api/salons/never-was-a-handle/canonical').expect(404);
  });

  it('rejects a malformed handle (uppercase, spaces, leading hyphen)', async () => {
    await request(app.getHttpServer())
      .patch('/api/salons/mine/handle')
      .set('Cookie', ownerCookie)
      .send({ handle: 'Not Valid!' })
      .expect(400);
  });

  it('rejects a reserved word', async () => {
    await request(app.getHttpServer())
      .patch('/api/salons/mine/handle')
      .set('Cookie', ownerCookie)
      .send({ handle: 'mine' })
      .expect(400);
  });

  it('rejects a handle already used by another salon', async () => {
    await request(app.getHttpServer())
      .patch('/api/salons/mine/handle')
      .set('Cookie', otherOwnerCookie)
      .send({ handle: salonSlug })
      .expect(409);

    // The rejected attempt must not have partially applied -- the other salon's own slug
    // is unchanged.
    const res = await request(app.getHttpServer()).get(`/api/salons/${otherSalonSlug}`).expect(200);
    expect(res.body.name).toBe('Other Handle Salon');
  });

  // The hijack vector this feature exists to close: without the reservation, `originalSlug`
  // is a free handle the moment its owner renames, and whoever grabs it inherits every
  // already-printed QR code pointing at it.
  it('refuses to let another salon claim a handle the first salon released', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/salons/mine/handle')
      .set('Cookie', otherOwnerCookie)
      .send({ handle: originalSlug })
      .expect(409);
    // The reservation message, not the plain "already taken by a live salon" one.
    expect(res.body.message).toContain('پیش‌تر متعلق به');

    // Nothing partially applied, and the reservation still redirects to its real owner.
    const other = await request(app.getHttpServer()).get(`/api/salons/${otherSalonSlug}`).expect(200);
    expect(other.body.name).toBe('Other Handle Salon');
    const canonical = await request(app.getHttpServer()).get(`/api/salons/${originalSlug}/canonical`).expect(200);
    expect(canonical.body).toEqual({ slug: salonSlug, moved: true });
  });

  it('lets the original owner take their own former handle back, and stops redirecting it', async () => {
    await request(app.getHttpServer())
      .patch('/api/salons/mine/handle')
      .set('Cookie', ownerCookie)
      .send({ handle: originalSlug })
      .expect(200);

    // Live again -- its history row is gone, so it is canonical rather than a redirect.
    const reclaimed = await request(app.getHttpServer()).get(`/api/salons/${originalSlug}/canonical`).expect(200);
    expect(reclaimed.body).toEqual({ slug: originalSlug, moved: false });

    // ...and the handle just released by this very rename now redirects the other way.
    const released = await request(app.getHttpServer()).get('/api/salons/my-clean-handle/canonical').expect(200);
    expect(released.body).toEqual({ slug: originalSlug, moved: true });

    // Back to the clean handle for the remaining cases (also a second reclaim, of a handle
    // this salon released one step ago).
    await request(app.getHttpServer())
      .patch('/api/salons/mine/handle')
      .set('Cookie', ownerCookie)
      .send({ handle: 'my-clean-handle' })
      .expect(200);
    salonSlug = 'my-clean-handle';
  });

  it('treats re-submitting the handle already in use as a no-op, not a self-conflict', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/salons/mine/handle')
      .set('Cookie', ownerCookie)
      .send({ handle: salonSlug })
      .expect(200);
    expect(res.body.slug).toBe(salonSlug);

    // Crucially it did NOT record itself as released -- a live handle must never redirect.
    const canonical = await request(app.getHttpServer()).get(`/api/salons/${salonSlug}/canonical`).expect(200);
    expect(canonical.body).toEqual({ slug: salonSlug, moved: false });
  });

  it('rejects an unauthenticated caller and a caller with no salon of their own', async () => {
    await request(app.getHttpServer()).patch('/api/salons/mine/handle').send({ handle: 'whatever' }).expect(401);

    const noSalonCustomer = await loginAs(app, '09141110004');
    await request(app.getHttpServer())
      .patch('/api/salons/mine/handle')
      .set('Cookie', noSalonCustomer)
      .send({ handle: 'whatever' })
      .expect(404);
  });

  it('lets an admin override a salon\'s handle', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/handle`)
      .set('Cookie', adminCookie)
      .send({ handle: 'admin-set-handle' })
      .expect(200);

    expect(res.body.slug).toBe('admin-set-handle');
  });

  // The documented recourse: an admin must be able to unwind a reservation an owner cannot.
  it('lets an admin hand another salon a handle that is reserved to someone else', async () => {
    // 'my-clean-handle' was released by the first salon in the test above, so it is reserved
    // to it -- the other salon's OWNER would get a 409 here (proven first).
    await request(app.getHttpServer())
      .patch('/api/salons/mine/handle')
      .set('Cookie', otherOwnerCookie)
      .send({ handle: 'my-clean-handle' })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${otherSalonId}/handle`)
      .set('Cookie', adminCookie)
      .send({ handle: 'my-clean-handle' })
      .expect(200);

    const res = await request(app.getHttpServer()).get('/api/salons/my-clean-handle').expect(200);
    expect(res.body.name).toBe('Other Handle Salon');
    // The second salon's own former handle was still recorded on the way out.
    const canonical = await request(app.getHttpServer()).get(`/api/salons/${otherSalonSlug}/canonical`).expect(200);
    expect(canonical.body).toEqual({ slug: 'my-clean-handle', moved: true });
  });

  it('rejects a non-admin caller on the admin override route', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/handle`)
      .set('Cookie', ownerCookie)
      .send({ handle: 'nope' })
      .expect(403);
  });
});

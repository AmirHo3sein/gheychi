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
 */
describe('Salon public handle (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let otherOwnerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let salonSlug: string;
  let otherSalonSlug: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09141110001');
    ({ salonId, slug: salonSlug } = await createApprovedSalon(app, ownerCookie, { name: 'Handle Test Salon' }));

    otherOwnerCookie = await loginAs(app, '09141110002');
    ({ slug: otherSalonSlug } = await createApprovedSalon(app, otherOwnerCookie, { name: 'Other Handle Salon' }));

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

  it('rejects a non-admin caller on the admin override route', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/handle`)
      .set('Cookie', ownerCookie)
      .send({ handle: 'nope' })
      .expect(403);
  });
});

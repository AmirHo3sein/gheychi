import { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SalonService } from '../src/salons/salon-service.entity';
import { SalonServicesService } from '../src/salons/salon-services.service';
import { ServiceImageRemovalAndArchiveInvariant1758300000000 } from '../src/migrations/1758300000000-service-image-removal-and-archive-invariant';
import { STORAGE_PROVIDER, StorageProvider } from '../src/storage/storage.provider';
import { createApprovedSalonWithService, createService } from './factories/salon.factory';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

// Real, decodable images: the service-image path re-encodes through sharp and enforces a
// 200px minimum, so the 1x1 MINIMAL_PNG other upload suites use would be rejected here.
async function imageBytes(width = 400, height = 300, format: 'jpeg' | 'png' | 'webp' = 'png'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c08060' } }).toFormat(format).toBuffer();
}

describe('Salon service images (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let storage: StorageProvider;
  let ownerCookie: string;
  let otherOwnerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let slug: string;
  let categoryId: number;
  let serviceId: string;
  let otherServiceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);
    storage = app.get(STORAGE_PROVIDER);
    ownerCookie = await loginAs(app, '09167700001');
    otherOwnerCookie = await loginAs(app, '09167700002');
    customerCookie = await loginAs(app, '09167700003');

    ({ salonId, slug, categoryId, serviceId } = await createApprovedSalonWithService(
      app,
      ownerCookie,
      { name: 'Service Image Salon' },
      { name: 'With Image', price: 2000000 },
    ));
    ({ serviceId: otherServiceId } = await createApprovedSalonWithService(
      app,
      otherOwnerCookie,
      { name: 'Victim Salon' },
      { name: 'Victim Service' },
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  const upload = (id: string, cookie: string, file: Buffer, contentType = 'image/png', filename = 'a.png') =>
    request(app.getHttpServer())
      .post(`/api/salons/mine/services/${id}/image`)
      .set('Cookie', cookie)
      .attach('file', file, { filename, contentType });

  const removeImage = (id: string, cookie: string) =>
    request(app.getHttpServer()).delete(`/api/salons/mine/services/${id}/image`).set('Cookie', cookie);

  const dbRow = async (id: string) =>
    (await ds.query(`SELECT image_url, image_storage_key FROM salon_services WHERE id = $1`, [id]))[0];

  it('a service created without an image has imageUrl null', async () => {
    const res = await request(app.getHttpServer()).get('/api/salons/mine/services').set('Cookie', ownerCookie).expect(200);
    const svc = res.body.find((s: { id: string }) => s.id === serviceId);
    expect(svc.imageUrl).toBeNull();
    expect(svc.imageStorageKey).toBeNull();
  });

  it('ignores image fields smuggled into the JSON create/update bodies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId, name: 'Smuggle', price: 500000, durationMin: 30, imageUrl: 'http://evil/x.jpg', imageStorageKey: 'x' })
      .expect(201);
    expect(res.body.imageUrl).toBeNull();
    expect(res.body.imageRemovedByAdminAt).toBeNull();
    expect(await dbRow(res.body.id)).toEqual({ image_url: null, image_storage_key: null });
  });

  let firstKey: string;
  let firstUrl: string;

  it('uploads an image -> 200 with the full service, stored as a normalized JPEG', async () => {
    const res = await upload(serviceId, ownerCookie, await imageBytes(2400, 1600, 'png')).expect(200);

    expect(res.body.id).toBe(serviceId);
    expect(res.body.name).toBe('With Image');
    expect(res.body.price).toBe(2000000);
    expect(res.body.imageUrl).toContain('/uploads/');
    expect(res.body.imageStorageKey).toMatch(new RegExp(`^salons/${salonId}/services/${serviceId}/[0-9a-f-]{36}\\.jpg$`));
    firstKey = res.body.imageStorageKey;
    firstUrl = res.body.imageUrl;

    expect(await storage.exists(firstKey)).toBe(true);
    const meta = await sharp(await storage.read(firstKey)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1200);

    const fileRes = await request(app.getHttpServer()).get(new URL(firstUrl).pathname).expect(200);
    expect(fileRes.headers['x-content-type-options']).toBe('nosniff');
  });

  it('a PATCH of name only keeps the image', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/services/${serviceId}`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Renamed', imageUrl: null, imageStorageKey: null })
      .expect(200);
    expect(res.body.name).toBe('Renamed');
    expect(res.body.imageUrl).toBe(firstUrl);
    expect(await dbRow(serviceId)).toEqual({ image_url: firstUrl, image_storage_key: firstKey });
  });

  let secondKey: string;

  it('replacing the image returns a new url and deletes the old object', async () => {
    const res = await upload(serviceId, ownerCookie, await imageBytes(500, 500, 'webp'), 'image/webp', 'b.webp').expect(200);
    secondKey = res.body.imageStorageKey;
    expect(secondKey).not.toBe(firstKey);
    expect(res.body.imageUrl).not.toBe(firstUrl);
    expect(await storage.exists(secondKey)).toBe(true);
    expect(await storage.exists(firstKey)).toBe(false);
  });

  it('rejects a text file (422) without touching the row or storage', async () => {
    const res = await upload(serviceId, ownerCookie, Buffer.from('not an image'), 'text/plain', 'a.txt').expect(422);
    expect(res.body.message).toBe('فقط تصاویر JPEG، PNG یا WebP پذیرفته می‌شوند');
    expect((await dbRow(serviceId)).image_storage_key).toBe(secondKey);
  });

  // What a browser actually sends for a non-image renamed to .jpg: the declared type comes
  // from the extension, so only the magic-number sniff catches it -- and the provider panel
  // shows this message verbatim, so it must be Persian, not the validator's English.
  it('rejects non-image bytes declared as image/jpeg (422) with a Persian message', async () => {
    const res = await upload(serviceId, ownerCookie, Buffer.from('not an image'), 'image/jpeg', 'fake.jpg').expect(422);
    expect(res.body.message).toBe('فقط تصاویر JPEG، PNG یا WebP پذیرفته می‌شوند');
    expect((await dbRow(serviceId)).image_storage_key).toBe(secondKey);
  });

  it('rejects a request with no file part (422) with a Persian message', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/salons/mine/services/${serviceId}/image`)
      .set('Cookie', ownerCookie)
      .field('note', 'x')
      .expect(422);
    expect(res.body.message).toBe('فایل تصویری ارسال نشده است');
    expect((await dbRow(serviceId)).image_storage_key).toBe(secondKey);
  });

  it('rejects real image bytes under a spoofed Content-Type (400) without touching the row', async () => {
    await upload(serviceId, ownerCookie, await imageBytes(), 'text/html', 'a.html').expect(400);
    expect((await dbRow(serviceId)).image_storage_key).toBe(secondKey);
  });

  it('rejects an image under 200px (400) without touching the row', async () => {
    const res = await upload(serviceId, ownerCookie, await imageBytes(150, 400)).expect(400);
    expect(res.body.message).toMatch(/کوچک/);
    expect((await dbRow(serviceId)).image_storage_key).toBe(secondKey);
  });

  it('rejects a file over 5 MB (413) without touching the row', async () => {
    const big = Buffer.concat([await imageBytes(), Buffer.alloc(5 * 1024 * 1024)]);
    await upload(serviceId, ownerCookie, big).expect(413);
    expect((await dbRow(serviceId)).image_storage_key).toBe(secondKey);
  });

  it('nothing but the current image exists under the service prefix', async () => {
    const objects = await storage.list(`salons/${salonId}/services/${serviceId}/`);
    expect(objects.map((o) => o.key)).toEqual([secondKey]);
  });

  it("another owner's service -> 404 for POST and DELETE, victim's image unchanged", async () => {
    const victim = await upload(otherServiceId, otherOwnerCookie, await imageBytes()).expect(200);
    const victimKey = victim.body.imageStorageKey;

    await upload(otherServiceId, ownerCookie, await imageBytes()).expect(404);
    await removeImage(otherServiceId, ownerCookie).expect(404);

    expect(await dbRow(otherServiceId)).toEqual({ image_url: victim.body.imageUrl, image_storage_key: victimKey });
    expect(await storage.exists(victimKey)).toBe(true);
    // The rejected upload's own object must have been cleaned up, not left in the attacker's prefix.
    expect(await storage.list(`salons/${salonId}/services/${otherServiceId}/`)).toEqual([]);
  });

  it('a customer who owns no salon -> 404 (SalonOwnerGuard)', async () => {
    await upload(serviceId, customerCookie, await imageBytes()).expect(404);
    await removeImage(serviceId, customerCookie).expect(404);
  });

  it('unauthenticated -> 401', async () => {
    await request(app.getHttpServer())
      .post(`/api/salons/mine/services/${serviceId}/image`)
      .attach('file', await imageBytes(), { filename: 'a.png', contentType: 'image/png' })
      .expect(401);
    await request(app.getHttpServer()).delete(`/api/salons/mine/services/${serviceId}/image`).expect(401);
  });

  it('a nonexistent service id -> 404 and no object is left behind', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    await upload(ghost, ownerCookie, await imageBytes()).expect(404);
    expect(await storage.list(`salons/${salonId}/services/${ghost}/`)).toEqual([]);
  });

  it('public GET /salons/:slug/services exposes imageUrl but never imageStorageKey', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${slug}/services`).expect(200);
    const svc = res.body.find((s: { id: string }) => s.id === serviceId);
    expect(svc.imageUrl).toContain('/uploads/');
    expect(svc).not.toHaveProperty('imageStorageKey');
    for (const s of res.body) {
      expect(s).not.toHaveProperty('imageStorageKey');
      expect(s).not.toHaveProperty('imageRemovedByAdminAt');
    }
  });

  it('booking a service with an image prices it identically to the same service without one', async () => {
    const plainServiceId = await createService(app, ownerCookie, categoryId, { name: 'No Image', price: 2000000 });
    const start = (h: number) => new Date(Date.now() + h * 60 * 60_000).toISOString();

    const withImage = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: start(24) })
      .expect(201);
    const withoutImage = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId: plainServiceId, startsAt: start(48) })
      .expect(201);

    expect(withImage.body.booking.priceSnapshot).toBe(withoutImage.body.booking.priceSnapshot);
    expect(withImage.body.booking.depositAmount).toBe(withoutImage.body.booking.depositAmount);
    expect(withImage.body.booking.status).toBe(withoutImage.body.booking.status);
    expect(Object.keys(withImage.body).sort()).toEqual(Object.keys(withoutImage.body).sort());
    expect(Object.keys(withImage.body.booking).sort()).toEqual(Object.keys(withoutImage.body.booking).sort());
  });

  it('DELETE image -> 200 with imageUrl null and the object deleted', async () => {
    const res = await removeImage(serviceId, ownerCookie).expect(200);
    expect(res.body.id).toBe(serviceId);
    expect(res.body.imageUrl).toBeNull();
    expect(res.body.imageStorageKey).toBeNull();
    expect(await dbRow(serviceId)).toEqual({ image_url: null, image_storage_key: null });
    expect(await storage.exists(secondKey)).toBe(false);
  });

  it('DELETE image again is idempotent (200, unchanged)', async () => {
    const res = await removeImage(serviceId, ownerCookie).expect(200);
    expect(res.body.imageUrl).toBeNull();
  });

  // Archive semantics changed: archiving now clears the image and deletes the object (see
  // SalonServicesService.archive -- nothing can un-archive, nothing renders it). The owner's
  // image endpoints still 404 for an archived row.
  it('archiving a service clears its image and deletes the object; image endpoints then 404 for it', async () => {
    const archivedId = await createService(app, ownerCookie, categoryId, { name: 'To Archive' });
    const up = await upload(archivedId, ownerCookie, await imageBytes()).expect(200);
    const key = up.body.imageStorageKey;

    await request(app.getHttpServer()).delete(`/api/salons/mine/services/${archivedId}`).set('Cookie', ownerCookie).expect(204);

    expect(await dbRow(archivedId)).toEqual({ image_url: null, image_storage_key: null });
    expect((await ds.query(`SELECT is_active FROM salon_services WHERE id = $1`, [archivedId]))[0].is_active).toBe(false);
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.list(`salons/${salonId}/services/${archivedId}/`)).toEqual([]);
    await upload(archivedId, ownerCookie, await imageBytes()).expect(404);
    await removeImage(archivedId, ownerCookie).expect(404);
    // Archive keeps its existing semantics: an already-archived row of this salon 204s again,
    // another salon's id 404s.
    await request(app.getHttpServer()).delete(`/api/salons/mine/services/${archivedId}`).set('Cookie', ownerCookie).expect(204);
    await request(app.getHttpServer()).delete(`/api/salons/mine/services/${archivedId}`).set('Cookie', otherOwnerCookie).expect(404);
    // The archived service stays out of the public list.
    const pub = await request(app.getHttpServer()).get(`/api/salons/${slug}/services`).expect(200);
    expect(pub.body.map((s: { id: string }) => s.id)).not.toContain(archivedId);
  });

  it('a field PATCH racing an image upload never writes the stale image back (row keeps the new, live object)', async () => {
    const racedId = await createService(app, ownerCookie, categoryId, { name: 'Raced' });
    const before = await upload(racedId, ownerCookie, await imageBytes()).expect(200);
    const oldKey: string = before.body.imageStorageKey;

    // Deterministic interleaving: the PATCH reads the row, then an image replace commits
    // (and deletes the old object), then the PATCH saves what it read.
    const repo = app.get<Repository<SalonService>>(getRepositoryToken(SalonService));
    const svc = app.get(SalonServicesService);
    const original = repo.findOneBy.bind(repo);
    let newKey = '';
    const spy = jest.spyOn(repo, 'findOneBy').mockImplementationOnce(async (where) => {
      const stale = await original(where);
      spy.mockRestore();
      newKey = (await svc.setImage(salonId, racedId, await imageBytes(600, 600))).imageStorageKey!;
      return stale;
    });

    await request(app.getHttpServer())
      .patch(`/api/salons/mine/services/${racedId}`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Raced Renamed' })
      .expect(200);

    expect(newKey).not.toBe('');
    expect(await storage.exists(oldKey)).toBe(false);
    const row = await dbRow(racedId);
    expect(row.image_storage_key).toBe(newKey);
    expect(await storage.exists(row.image_storage_key)).toBe(true);
    expect((await ds.query(`SELECT name FROM salon_services WHERE id = $1`, [racedId]))[0].name).toBe('Raced Renamed');
  });

  it('a field PATCH racing an archive 404s instead of resurrecting the archived service', async () => {
    const racedId = await createService(app, ownerCookie, categoryId, { name: 'Raced Archive' });
    const repo = app.get<Repository<SalonService>>(getRepositoryToken(SalonService));
    const original = repo.findOneBy.bind(repo);
    const spy = jest.spyOn(repo, 'findOneBy').mockImplementationOnce(async (where) => {
      const stale = await original(where);
      spy.mockRestore();
      await request(app.getHttpServer()).delete(`/api/salons/mine/services/${racedId}`).set('Cookie', ownerCookie).expect(204);
      return stale;
    });

    await request(app.getHttpServer())
      .patch(`/api/salons/mine/services/${racedId}`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Should Not Apply' })
      .expect(404);
    expect((await ds.query(`SELECT name, is_active FROM salon_services WHERE id = $1`, [racedId]))[0]).toEqual({
      name: 'Raced Archive',
      is_active: false,
    });
  });

  it('two concurrent uploads to one service: the row holds exactly one live object and nothing else is left behind', async () => {
    const racedId = await createService(app, ownerCookie, categoryId, { name: 'Double Upload' });
    const first = await upload(racedId, ownerCookie, await imageBytes()).expect(200);

    const [a, b] = await Promise.all([
      upload(racedId, ownerCookie, await imageBytes(500, 500)),
      upload(racedId, ownerCookie, await imageBytes(600, 600)),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);

    const row = await dbRow(racedId);
    expect([a.body.imageStorageKey, b.body.imageStorageKey]).toContain(row.image_storage_key);
    expect(row.image_url).toBe(row.image_storage_key === a.body.imageStorageKey ? a.body.imageUrl : b.body.imageUrl);
    const objects = await storage.list(`salons/${salonId}/services/${racedId}/`);
    expect(objects.map((o) => o.key)).toEqual([row.image_storage_key]);
    expect(await storage.exists(first.body.imageStorageKey)).toBe(false);
  });

  // Deterministic lock-queue races: a raw transaction holds the row lock while the two real
  // requests queue up behind it in a known order (Postgres grants a tuple lock to waiters in
  // arrival order), then it releases and the queue drains.
  describe('row-lock ordering races', () => {
    const lockWaiters = async (): Promise<number> =>
      Number(
        (
          await ds.query(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
          )
        )[0].n,
      );
    const waitForLockWaiters = async (n: number): Promise<void> => {
      for (let i = 0; i < 400; i++) {
        if ((await lockWaiters()) >= n) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`timed out waiting for ${n} lock waiter(s)`);
    };
    const holdRowLock = async (id: string) => {
      const qr = ds.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      await qr.query(`SELECT id FROM salon_services WHERE id = $1 FOR UPDATE`, [id]);
      return {
        release: async () => {
          await qr.commitTransaction();
          await qr.release();
        },
      };
    };
    const archive = (id: string) =>
      request(app.getHttpServer()).delete(`/api/salons/mine/services/${id}`).set('Cookie', ownerCookie);
    let adminCookie: string;
    const adminRemove = (id: string) =>
      request(app.getHttpServer()).delete(`/api/admin/services/${id}/image`).set('Cookie', adminCookie);

    beforeAll(async () => {
      adminCookie = await loginAsAdmin(app, '09167700009');
    });

    it('archive wins the lock, upload queued behind it: upload 404s and leaves no public object', async () => {
      const id = await createService(app, ownerCookie, categoryId, { name: 'Race Archive First' });
      const held = await holdRowLock(id);
      const archiving = archive(id).then((r) => r);
      await waitForLockWaiters(1);
      const uploading = upload(id, ownerCookie, await imageBytes()).then((r) => r);
      await waitForLockWaiters(2);
      await held.release();
      const [a, u] = await Promise.all([archiving, uploading]);

      expect(a.status).toBe(204);
      expect(u.status).toBe(404);
      expect(await ds.query(`SELECT is_active, image_url, image_storage_key FROM salon_services WHERE id = $1`, [id])).toEqual([
        { is_active: false, image_url: null, image_storage_key: null },
      ]);
      expect(await storage.list(`salons/${salonId}/services/${id}/`)).toEqual([]);
    });

    it('upload wins the lock, archive queued behind it: archive clears and deletes the new object', async () => {
      const id = await createService(app, ownerCookie, categoryId, { name: 'Race Upload First' });
      const held = await holdRowLock(id);
      const uploading = upload(id, ownerCookie, await imageBytes()).then((r) => r);
      await waitForLockWaiters(1);
      const archiving = archive(id).then((r) => r);
      await waitForLockWaiters(2);
      await held.release();
      const [u, a] = await Promise.all([uploading, archiving]);

      expect(u.status).toBe(200);
      expect(a.status).toBe(204);
      expect(await ds.query(`SELECT is_active, image_url, image_storage_key FROM salon_services WHERE id = $1`, [id])).toEqual([
        { is_active: false, image_url: null, image_storage_key: null },
      ]);
      expect(await storage.exists(u.body.imageStorageKey)).toBe(false);
      expect(await storage.list(`salons/${salonId}/services/${id}/`)).toEqual([]);
    });

    it('admin removal wins the lock, owner re-upload queued behind it: row holds exactly the new object', async () => {
      const id = await createService(app, ownerCookie, categoryId, { name: 'Race Admin First' });
      const old = await upload(id, ownerCookie, await imageBytes()).expect(200);
      const held = await holdRowLock(id);
      const removing = adminRemove(id).then((r) => r);
      await waitForLockWaiters(1);
      const uploading = upload(id, ownerCookie, await imageBytes(500, 500)).then((r) => r);
      await waitForLockWaiters(2);
      await held.release();
      const [r, u] = await Promise.all([removing, uploading]);

      expect(r.status).toBe(200);
      expect(u.status).toBe(200);
      expect(await dbRow(id)).toEqual({ image_url: u.body.imageUrl, image_storage_key: u.body.imageStorageKey });
      expect((await storage.list(`salons/${salonId}/services/${id}/`)).map((o) => o.key)).toEqual([u.body.imageStorageKey]);
      expect(await storage.exists(old.body.imageStorageKey)).toBe(false);
    });

    it('owner upload wins the lock, admin removal queued behind it: the new image is taken down, nothing left', async () => {
      const id = await createService(app, ownerCookie, categoryId, { name: 'Race Upload Before Admin' });
      await upload(id, ownerCookie, await imageBytes()).expect(200);
      const held = await holdRowLock(id);
      const uploading = upload(id, ownerCookie, await imageBytes(500, 500)).then((r) => r);
      await waitForLockWaiters(1);
      const removing = adminRemove(id).then((r) => r);
      await waitForLockWaiters(2);
      await held.release();
      const [u, r] = await Promise.all([uploading, removing]);

      expect(u.status).toBe(200);
      expect(r.status).toBe(200);
      expect(await dbRow(id)).toEqual({ image_url: null, image_storage_key: null });
      expect(await storage.list(`salons/${salonId}/services/${id}/`)).toEqual([]);
      const [audit] = await ds.query(
        `SELECT payload FROM audit_log WHERE action = 'salon.service.image.removed' AND target_id = $1 AND success`,
        [id],
      );
      // The audit before-snapshot is the row as the admin's locked read saw it: the new image.
      expect(audit.payload.before.imageStorageKey).toBe(u.body.imageStorageKey);
    });
  });

  it('admin salon detail exposes each service imageUrl', async () => {
    const up = await upload(serviceId, ownerCookie, await imageBytes()).expect(200);
    const adminCookie = await loginAsAdmin(app, '09167700009');
    const res = await request(app.getHttpServer()).get(`/api/admin/salons/${salonId}`).set('Cookie', adminCookie).expect(200);
    const svc = res.body.services.find((s: { id: string }) => s.id === serviceId);
    expect(svc.imageUrl).toBe(up.body.imageUrl);
    expect(svc).toHaveProperty('imageRemovedByAdminAt', null);
  });

  describe('admin takedown: DELETE /api/admin/services/:id/image', () => {
    let adminCookie: string;
    const adminRemove = (id: string, cookie?: string) => {
      const req = request(app.getHttpServer()).delete(`/api/admin/services/${id}/image`);
      return cookie ? req.set('Cookie', cookie) : req;
    };
    const fullRow = async (id: string) =>
      (
        await ds.query(
          `SELECT name, pricing_type, price, price_max, duration_min, duration_max, discount_percent, is_active, image_url, image_storage_key
             FROM salon_services WHERE id = $1`,
          [id],
        )
      )[0];

    beforeAll(async () => {
      adminCookie = await loginAsAdmin(app, '09167700009');
    });

    it('removes an active service image: 200 shape, only image columns change, object deleted, booking untouched, audited', async () => {
      const targetId = await createService(app, ownerCookie, categoryId, { name: 'Admin Target', price: 1500000 });
      const up = await upload(targetId, ownerCookie, await imageBytes()).expect(200);
      const key: string = up.body.imageStorageKey;
      const booked = await request(app.getHttpServer())
        .post('/api/bookings')
        .set('Cookie', customerCookie)
        .send({ salonId, serviceId: targetId, startsAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString() })
        .expect(201);
      const bookingBefore = (await ds.query(`SELECT * FROM bookings WHERE id = $1`, [booked.body.booking.id]))[0];
      const rowBefore = await fullRow(targetId);

      const res = await adminRemove(targetId, adminCookie).expect(200);

      expect(res.body).toEqual({ id: targetId, salonId, name: 'Admin Target', isActive: true, imageUrl: null });
      expect(await fullRow(targetId)).toEqual({ ...rowBefore, image_url: null, image_storage_key: null });
      const [{ image_removed_by_admin_at: removedAt }] = await ds.query(
        `SELECT image_removed_by_admin_at FROM salon_services WHERE id = $1`,
        [targetId],
      );
      expect(removedAt).toBeInstanceOf(Date);
      expect(await storage.exists(key)).toBe(false);
      expect((await ds.query(`SELECT * FROM bookings WHERE id = $1`, [booked.body.booking.id]))[0]).toEqual(bookingBefore);

      const [audit] = await ds.query(
        `SELECT a.actor_id, a.target_type, a.target_id, a.payload, a.success, u.phone
           FROM audit_log a JOIN users u ON u.id = a.actor_id
          WHERE a.action = 'salon.service.image.removed' AND a.target_id = $1 AND a.success`,
        [targetId],
      );
      expect(audit).toMatchObject({ target_type: 'salonservice', target_id: targetId, success: true, phone: '09167700009' });
      expect(audit.payload).toEqual({
        before: { imageUrl: up.body.imageUrl, imageStorageKey: key, salonId, serviceName: 'Admin Target' },
        after: { imageUrl: null },
      });
    });

    it('a second removal 409s with the Persian message (and is audited as a failure)', async () => {
      const targetId = await createService(app, ownerCookie, categoryId, { name: 'No Image Target' });
      const res = await adminRemove(targetId, adminCookie).expect(409);
      expect(res.body.message).toBe('این خدمت تصویری ندارد');
      const rows = await ds.query(
        `SELECT success FROM audit_log WHERE action = 'salon.service.image.removed' AND target_id = $1`,
        [targetId],
      );
      expect(rows).toEqual([{ success: false }]);
    });

    // Rewritten for the archive invariant (migration 1758300000000): this used to simulate a
    // legacy archived row that kept its image and assert the admin could still take it down.
    // Such a row can no longer exist -- the CHECK rejects it -- so the admin endpoint now
    // simply 409s on an archived row, like any other row with no image.
    it('an archived row cannot hold an image (CHECK), so admin removal on it 409s', async () => {
      const targetId = await createService(app, ownerCookie, categoryId, { name: 'Archived Target' });
      const up = await upload(targetId, ownerCookie, await imageBytes()).expect(200);

      await expect(ds.query(`UPDATE salon_services SET is_active = false WHERE id = $1`, [targetId])).rejects.toMatchObject({
        constraint: 'salon_services_archived_no_image_chk',
      });
      expect(await dbRow(targetId)).toEqual({ image_url: up.body.imageUrl, image_storage_key: up.body.imageStorageKey });

      await request(app.getHttpServer()).delete(`/api/salons/mine/services/${targetId}`).set('Cookie', ownerCookie).expect(204);
      const res = await adminRemove(targetId, adminCookie).expect(409);
      expect(res.body.message).toBe('این خدمت تصویری ندارد');
      await expect(
        ds.query(`UPDATE salon_services SET image_url = 'http://x/y.jpg', image_storage_key = 'k' WHERE id = $1`, [targetId]),
      ).rejects.toMatchObject({ constraint: 'salon_services_archived_no_image_chk' });
    });

    describe('owner takedown notice (imageRemovedByAdminAt)', () => {
      const ownerSvc = async (id: string) =>
        (await request(app.getHttpServer()).get('/api/salons/mine/services').set('Cookie', ownerCookie).expect(200)).body.find(
          (x: { id: string }) => x.id === id,
        );
      const publicSvc = async (id: string) =>
        (await request(app.getHttpServer()).get(`/api/salons/${slug}/services`).expect(200)).body.find(
          (x: { id: string }) => x.id === id,
        );
      const adminSvc = async (id: string) =>
        (await request(app.getHttpServer()).get(`/api/admin/salons/${salonId}`).set('Cookie', adminCookie).expect(200)).body.services.find(
          (x: { id: string }) => x.id === id,
        );
      const takenDown = async (name: string) => {
        const id = await createService(app, ownerCookie, categoryId, { name });
        await upload(id, ownerCookie, await imageBytes()).expect(200);
        await adminRemove(id, adminCookie).expect(200);
        return id;
      };

      it('is set by the takedown and shown to the owner and admin, never on the public list', async () => {
        const t0 = Date.now();
        const id = await takenDown('Notice Shown');

        const owner = await ownerSvc(id);
        expect(owner.imageUrl).toBeNull();
        expect(new Date(owner.imageRemovedByAdminAt).getTime()).toBeGreaterThanOrEqual(t0 - 5_000);

        const admin = await adminSvc(id);
        expect(admin.imageUrl).toBeNull();
        expect(admin.imageRemovedByAdminAt).toBe(owner.imageRemovedByAdminAt);

        const pub = await publicSvc(id);
        expect(pub).toBeDefined();
        expect(pub).not.toHaveProperty('imageRemovedByAdminAt');
      });

      it('a field PATCH leaves the notice in place', async () => {
        const id = await takenDown('Notice Patch');
        const res = await request(app.getHttpServer())
          .patch(`/api/salons/mine/services/${id}`)
          .set('Cookie', ownerCookie)
          .send({ name: 'Notice Patch 2', imageRemovedByAdminAt: null })
          .expect(200);
        expect(res.body.imageRemovedByAdminAt).not.toBeNull();
      });

      it("is cleared by the owner's new upload (response reflects it)", async () => {
        const id = await takenDown('Notice Upload');
        const res = await upload(id, ownerCookie, await imageBytes()).expect(200);
        expect(res.body.imageUrl).toContain('/uploads/');
        expect(res.body.imageRemovedByAdminAt).toBeNull();
        expect((await ownerSvc(id)).imageRemovedByAdminAt).toBeNull();
      });

      it("is cleared by the owner's remove, even with no image left to remove", async () => {
        const id = await takenDown('Notice Remove');
        const res = await removeImage(id, ownerCookie).expect(200);
        expect(res.body.imageUrl).toBeNull();
        expect(res.body.imageRemovedByAdminAt).toBeNull();
        expect((await adminSvc(id)).imageRemovedByAdminAt).toBeNull();
      });

      it('a second takedown after a re-upload stamps it again', async () => {
        const id = await takenDown('Notice Twice');
        await upload(id, ownerCookie, await imageBytes()).expect(200);
        await adminRemove(id, adminCookie).expect(200);
        expect((await ownerSvc(id)).imageRemovedByAdminAt).not.toBeNull();
      });
    });

    it('unknown id -> 404; malformed id -> 400', async () => {
      await adminRemove('00000000-0000-4000-8000-000000000000', adminCookie).expect(404);
      await adminRemove('not-a-uuid', adminCookie).expect(400);
    });

    it('provider -> 403, customer -> 403, unauthenticated -> 401; the image survives', async () => {
      const targetId = await createService(app, ownerCookie, categoryId, { name: 'Guarded' });
      const up = await upload(targetId, ownerCookie, await imageBytes()).expect(200);

      await adminRemove(targetId, ownerCookie).expect(403);
      await adminRemove(targetId, customerCookie).expect(403);
      await adminRemove(targetId).expect(401);

      expect(await dbRow(targetId)).toEqual({ image_url: up.body.imageUrl, image_storage_key: up.body.imageStorageKey });
      expect(await storage.exists(up.body.imageStorageKey)).toBe(true);
    });
  });

  // The migration's cleanup UPDATE, run for real against this DB inside a transaction that
  // is rolled back: undo the migration's own schema change (DDL is transactional in
  // Postgres), plant a legacy archived-with-image row, run up(), assert, roll back.
  it('migration 1758300000000 clears legacy archived images and installs the CHECK', async () => {
    const legacyId = await createService(app, ownerCookie, categoryId, { name: 'Legacy Archived' });
    const activeId = await createService(app, ownerCookie, categoryId, { name: 'Legacy Active' });
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await new ServiceImageRemovalAndArchiveInvariant1758300000000().down(qr);
      await qr.query(
        `UPDATE salon_services SET is_active = false, image_url = 'http://cdn/legacy.jpg', image_storage_key = 'salons/x/services/legacy.jpg'
          WHERE id = $1`,
        [legacyId],
      );
      await qr.query(
        `UPDATE salon_services SET image_url = 'http://cdn/active.jpg', image_storage_key = 'salons/x/services/active.jpg' WHERE id = $1`,
        [activeId],
      );

      await new ServiceImageRemovalAndArchiveInvariant1758300000000().up(qr);

      const rows = await qr.query(
        `SELECT id, is_active, image_url, image_storage_key, image_removed_by_admin_at FROM salon_services WHERE id = ANY($1) ORDER BY name`,
        [[legacyId, activeId]],
      );
      expect(rows).toEqual([
        { id: activeId, is_active: true, image_url: 'http://cdn/active.jpg', image_storage_key: 'salons/x/services/active.jpg', image_removed_by_admin_at: null },
        { id: legacyId, is_active: false, image_url: null, image_storage_key: null, image_removed_by_admin_at: null },
      ]);
      await expect(qr.query(`UPDATE salon_services SET is_active = false WHERE id = $1`, [activeId])).rejects.toMatchObject({
        constraint: 'salon_services_archived_no_image_chk',
      });
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});

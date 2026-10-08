import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BEAUTY_PROMPT_VERSION, BEAUTY_SCHEMA_VERSION } from '../src/beauty-guide/analysis/beauty-analysis.contract';
import { BEAUTY_ANALYSIS_PROVIDER } from '../src/beauty-guide/analysis/beauty-analysis.provider';
import { MockBeautyAnalysisProvider } from '../src/beauty-guide/analysis/mock-beauty-analysis.provider';
import { BeautyGuideRetentionJob } from '../src/beauty-guide/beauty-guide-retention.job';
import { PRIVATE_IMAGE_STORE, PrivateImageStore } from '../src/beauty-guide/private-image.store';
import { createApprovedSalon, createService } from './factories/salon.factory';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

// Random pixels → distinct bytes → distinct hashes, so each upload is a "new" image unless a
// test deliberately re-sends the same buffer. (Near-identical solid colours can JPEG-encode to
// byte-identical files and would silently hit the per-user duplicate cache.)
async function inspirationImage(width = 300, height = 400): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).jpeg({ quality: 60 }).toBuffer();
}

describe('Beauty Guide (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let mock: MockBeautyAnalysisProvider;
  let customer: string;
  let otherCustomer: string;
  let owner: string;
  let otherOwner: string;
  let admin: string;
  let colorCategoryId: number;
  let nailCategoryId: number;
  let salonId: string;
  let salonSlug: string;
  let fixedServiceId: string;
  let quoteServiceId: string;
  let inactiveServiceId: string;
  let otherSalonId: string;

  const http = () => request(app.getHttpServer());
  const setFlag = async (on: boolean) => {
    await ds.query(`UPDATE platform_config SET value = $1 WHERE key = 'feature_beauty_guide_enabled'`, [on ? 'true' : 'false']);
    await http().patch('/api/admin/feature-flags').set('Cookie', admin).send({ beautyGuideEnabled: on }).expect(200);
  };
  const upload = (cookie: string, buffer: Buffer, contentType = 'image/jpeg') =>
    http().post('/api/beauty-guides').set('Cookie', cookie).attach('file', buffer, { filename: 'look.jpg', contentType });
  const resetUsage = () => ds.query(`UPDATE beauty_guides SET analyzed_at = analyzed_at - interval '3 days' WHERE provider_called`);

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    ds = app.get(DataSource);
    mock = app.get(BEAUTY_ANALYSIS_PROVIDER);

    admin = await loginAsAdmin(app, '09125550001');
    customer = await loginAs(app, '09125550002');
    otherCustomer = await loginAs(app, '09125550003');
    owner = await loginAs(app, '09125550004');
    otherOwner = await loginAs(app, '09125550005');
    await ds.query(`UPDATE users SET gender = 'female', name = 'مشتری' WHERE phone IN ('09125550002', '09125550003')`);

    [{ id: colorCategoryId }] = await ds.query(`SELECT id FROM service_categories WHERE name = 'رنگ مو'`);
    [{ id: nailCategoryId }] = await ds.query(`SELECT id FROM service_categories WHERE name = 'ناخن'`);

    ({ salonId, slug: salonSlug } = await createApprovedSalon(app, owner, { name: 'سالن رنگ', categoryIds: [colorCategoryId] }));
    fixedServiceId = await createService(app, owner, colorCategoryId, { name: 'بالیاژ', price: 2_500_000, durationMin: 90 });
    quoteServiceId = await createService(app, owner, colorCategoryId, { name: 'اصلاح رنگ', pricingType: 'quote' });
    inactiveServiceId = await createService(app, owner, colorCategoryId, { name: 'رنگ قدیمی', price: 900_000 });
    await ds.query(`UPDATE salon_services SET is_active = false WHERE id = $1`, [inactiveServiceId]);

    // A men's salon offering the same category must never appear for a female customer.
    ({ salonId: otherSalonId } = await createApprovedSalon(app, otherOwner, { name: 'آقایان', genderTarget: 'men', categoryIds: [colorCategoryId] }));
    await createService(app, otherOwner, colorCategoryId, { name: 'رنگ مردانه', price: 700_000 });

    await setFlag(true);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    mock.useScenario('balayage');
    await resetUsage();
  });

  describe('feature flag', () => {
    it('hides every customer route while the flag is off, without touching bookings', async () => {
      await setFlag(false);
      await http().get('/api/beauty-guides').set('Cookie', customer).expect(404);
      await upload(customer, await inspirationImage()).expect(404);
      const flags = await http().get('/api/platform-config/feature-flags').expect(200);
      expect(flags.body.beautyGuideEnabled).toBe(false);
      await setFlag(true);
    });

    it('requires authentication', async () => {
      await http().get('/api/beauty-guides').expect(401);
    });

    it('exposes the active vocabulary for corrections (no category/keyword internals)', async () => {
      const res = await http().get('/api/beauty-guides/concepts').set('Cookie', customer).expect(200);
      expect(res.body.find((c: { key: string }) => c.key === 'balayage')).toEqual({ key: 'balayage', nameFa: 'بالیاژ', nameEn: 'Balayage', domain: 'hair_color' });
      expect(Object.keys(res.body[0]).sort()).toEqual(['domain', 'key', 'nameEn', 'nameFa']);
    });
  });

  describe('image validation', () => {
    it('rejects non-image bytes (422)', async () => {
      await upload(customer, Buffer.from('<html>not an image</html>')).expect(422);
    });

    it('rejects a real image declared with a spoofed content type (400)', async () => {
      await upload(customer, await inspirationImage(), 'text/html').expect(400);
    });

    it('rejects images that are too small (400)', async () => {
      await upload(customer, await inspirationImage(80, 80)).expect(400);
    });
  });

  describe('analysis', () => {
    let guideId: string;

    it('creates a ready guide from the mock analysis, dropping invented concepts', async () => {
      const res = await upload(customer, await inspirationImage()).expect(201);
      guideId = res.body.id;
      expect(res.body.status).toBe('ready');
      expect(res.body.concepts.map((c: { key: string }) => c.key)).toEqual(['balayage', 'root_melt', 'layered_cut']);
      expect(res.body.concepts.find((c: { key: string }) => c.key === 'balayage')).toMatchObject({
        nameFa: 'بالیاژ', nameEn: 'Balayage', confidence: 'high', source: 'ai', mappable: true,
      });
      // Raw scores never leave the API.
      expect(JSON.stringify(res.body)).not.toContain('0.92');
      expect(res.body.durationEstimate).toEqual({ min: 180, max: 300 });
      expect(res.body.maintenance[0].source).toBe('curated');
      expect(res.body.imagePath).toBe(`/beauty-guides/${guideId}/image`);
    });

    it('stores provider/model/prompt/schema versions for reproducibility', async () => {
      const [row] = await ds.query(`SELECT provider, model, prompt_version, schema_version, provider_called FROM beauty_guides WHERE id = $1`, [guideId]);
      expect(row).toEqual({ provider: 'mock', model: 'mock-v1', prompt_version: BEAUTY_PROMPT_VERSION, schema_version: BEAUTY_SCHEMA_VERSION, provider_called: true });
    });

    it('serves the private image only to its owner, never publicly', async () => {
      const res = await http().get(`/api/beauty-guides/${guideId}/image`).set('Cookie', customer).expect(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe('private, no-store');
      const meta = await sharp(res.body as Buffer).metadata();
      expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1024);
      expect(meta.exif).toBeUndefined();
      await http().get(`/api/beauty-guides/${guideId}/image`).set('Cookie', otherCustomer).expect(404);
      await http().get(`/api/beauty-guides/${guideId}/image`).expect(401);
      const [{ image_key }] = await ds.query(`SELECT image_key FROM beauty_guides WHERE id = $1`, [guideId]);
      await http().get(`/uploads/${image_key}`).expect(404);
    });

    it('returns the earlier guide for a duplicate image without calling the provider or using quota', async () => {
      const image = await inspirationImage();
      const first = await upload(customer, image).expect(201);
      const callsBefore = mock.calls;
      const again = await upload(customer, image).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.reused).toBe(true);
      expect(mock.calls).toBe(callsBefore);
    });

    it('does not share a duplicate across users', async () => {
      const image = await inspirationImage();
      const mine = await upload(customer, image).expect(201);
      const theirs = await upload(otherCustomer, image).expect(201);
      expect(theirs.body.id).not.toBe(mine.body.id);
    });

    it('marks provider failure as a retryable failed guide (no fake empty result)', async () => {
      mock.useScenario('error');
      const res = await upload(customer, await inspirationImage()).expect(201);
      expect(res.body).toMatchObject({ status: 'failed', failureCode: 'provider_error', concepts: [] });
      mock.useScenario('balayage');
      const retried = await http().post(`/api/beauty-guides/${res.body.id}/retry`).set('Cookie', customer).expect(201);
      expect(retried.body.status).toBe('ready');
    });

    it('handles timeouts', async () => {
      mock.useScenario('timeout');
      const res = await upload(customer, await inspirationImage()).expect(201);
      expect(res.body).toMatchObject({ status: 'failed', failureCode: 'timeout' });
    });

    it('rejects invalid AI output safely', async () => {
      mock.useScenario('invalid');
      const res = await upload(customer, await inspirationImage()).expect(201);
      expect(res.body).toMatchObject({ status: 'failed', failureCode: 'invalid_output', lookSummaryFa: null });
      const [{ raw_analysis }] = await ds.query(`SELECT raw_analysis FROM beauty_guides WHERE id = $1`, [res.body.id]);
      expect(raw_analysis).toBeNull();
    });

    it('reports a non-beauty image as unsuitable, not as an error', async () => {
      mock.useScenario('unsuitable');
      const res = await upload(customer, await inspirationImage()).expect(201);
      expect(res.body).toMatchObject({ status: 'unsuitable', failureCode: 'unsuitable' });
    });

    it('carries a medical-concern flag without diagnosing', async () => {
      mock.useScenario('medical');
      const res = await upload(customer, await inspirationImage()).expect(201);
      expect(res.body.safetyNote).toBe('medical_concern');
    });
  });

  describe('cost controls', () => {
    it('enforces the per-user daily limit, counting only real provider calls', async () => {
      await ds.query(`UPDATE platform_config SET value = '2' WHERE key = 'beauty_guide_daily_limit_per_user'`);
      await http().patch('/api/admin/config').set('Cookie', admin).send({ updates: [{ key: 'beauty_guide_daily_limit_per_user', value: 2 }] }).expect(200);
      await upload(customer, await inspirationImage()).expect(201);
      await upload(customer, await inspirationImage()).expect(201);
      const blocked = await upload(customer, await inspirationImage()).expect(429);
      expect(blocked.body.code).toBe('BEAUTY_GUIDE_DAILY_LIMIT');
      // Someone else is unaffected.
      await upload(otherCustomer, await inspirationImage()).expect(201);
      await http().patch('/api/admin/config').set('Cookie', admin).send({ updates: [{ key: 'beauty_guide_daily_limit_per_user', value: 3 }] }).expect(200);
    });

    it('does not charge quota when the provider is busy (429/503) — the customer can retry', async () => {
      await http().patch('/api/admin/config').set('Cookie', admin).send({ updates: [{ key: 'beauty_guide_daily_limit_per_user', value: 1 }] }).expect(200);
      mock.useScenario('busy');
      const busy = await upload(customer, await inspirationImage()).expect(201);
      expect(busy.body).toMatchObject({ status: 'failed', failureCode: 'provider_busy' });
      const [{ provider_called }] = await ds.query(`SELECT provider_called FROM beauty_guides WHERE id = $1`, [busy.body.id]);
      expect(provider_called).toBe(false);
      // The one allowed analysis today is still available.
      mock.useScenario('balayage');
      const retried = await http().post(`/api/beauty-guides/${busy.body.id}/retry`).set('Cookie', customer).expect(201);
      expect(retried.body.status).toBe('ready');
      await http().patch('/api/admin/config').set('Cookie', admin).send({ updates: [{ key: 'beauty_guide_daily_limit_per_user', value: 3 }] }).expect(200);
    });

    it('enforces the global daily cap', async () => {
      await http().patch('/api/admin/config').set('Cookie', admin).send({ updates: [{ key: 'beauty_guide_daily_limit_global', value: 0 }] }).expect(200);
      const res = await upload(customer, await inspirationImage()).expect(429);
      expect(res.body.code).toBe('BEAUTY_GUIDE_GLOBAL_LIMIT');
      await http().patch('/api/admin/config').set('Cookie', admin).send({ updates: [{ key: 'beauty_guide_daily_limit_global', value: 300 }] }).expect(200);
    });

    it('rejects out-of-bounds limit values on the write path (cannot brick boot)', async () => {
      await http().patch('/api/admin/config').set('Cookie', admin).send({ updates: [{ key: 'beauty_guide_daily_limit_per_user', value: 5000 }] }).expect(400);
      await http().patch('/api/admin/config').set('Cookie', admin).send({ updates: [{ key: 'beauty_guide_retention_days', value: 0 }] }).expect(400);
    });
  });

  describe('corrections, matching, privacy, booking', () => {
    let guideId: string;

    beforeAll(async () => {
      mock.useScenario('balayage');
      await resetUsage();
      guideId = (await upload(customer, await inspirationImage()).expect(201)).body.id;
    });

    it('maps concepts only to real, active services at approved, gender-matched salons', async () => {
      const res = await http().get(`/api/beauty-guides/${guideId}/matches?lat=35.7&lng=51.4`).set('Cookie', customer).expect(200);
      const salonIds = res.body.salons.map((s: { salon: { id: string } }) => s.salon.id);
      expect(salonIds).toEqual([salonId]);
      expect(salonIds).not.toContain(otherSalonId);
      const services = res.body.salons[0].services;
      const ids = services.map((s: { id: string }) => s.id);
      expect(ids).toEqual(expect.arrayContaining([fixedServiceId, quoteServiceId]));
      expect(ids).not.toContain(inactiveServiceId);
      // Real prices only; QUOTE stays priceless and not bookable online.
      expect(services.find((s: { id: string }) => s.id === fixedServiceId)).toMatchObject({ price: 2_500_000, pricingType: 'fixed', bookableOnline: true, durationMin: 90 });
      expect(services.find((s: { id: string }) => s.id === quoteServiceId)).toMatchObject({ price: null, priceMax: null, pricingType: 'quote', bookableOnline: false });
      expect(JSON.stringify(res.body)).not.toMatch(/total/i);
    });

    it('lets the customer remove, add and restore concepts — corrections are authoritative', async () => {
      let res = await http().patch(`/api/beauty-guides/${guideId}`).set('Cookie', customer)
        .send({ removeConceptKeys: ['balayage'], addConceptKeys: ['highlights'], attributes: { hair_length: 'medium' } })
        .expect(200);
      const byKey = Object.fromEntries(res.body.concepts.map((c: { key: string }) => [c.key, c]));
      expect(byKey.balayage.removed).toBe(true);
      expect(byKey.highlights).toMatchObject({ source: 'user', confidence: 'high', removed: false });
      expect(res.body.attributes.hair_length).toBe('medium');

      // Re-reading never re-applies the AI's original set over the corrections.
      res = await http().get(`/api/beauty-guides/${guideId}`).set('Cookie', customer).expect(200);
      expect(res.body.concepts.find((c: { key: string }) => c.key === 'balayage').removed).toBe(true);

      await http().patch(`/api/beauty-guides/${guideId}`).set('Cookie', customer).send({ attributes: { hair_length: 'enormous' } }).expect(400);
      await http().patch(`/api/beauty-guides/${guideId}`).set('Cookie', customer).send({ addConceptKeys: ['not_a_concept'] }).expect(400);
      await http().patch(`/api/beauty-guides/${guideId}`).set('Cookie', customer).send({ restoreConceptKeys: ['balayage'] }).expect(200);
    });

    it('excludes low-confidence AI guesses from matching until the customer confirms them', async () => {
      mock.useScenario('low_confidence');
      const low = (await upload(customer, await inspirationImage()).expect(201)).body;
      expect(low.concepts[0]).toMatchObject({ key: 'highlights', confidence: 'low' });
      let matches = await http().get(`/api/beauty-guides/${low.id}/matches?lat=35.7&lng=51.4`).set('Cookie', customer).expect(200);
      expect(matches.body).toMatchObject({ salons: [], emptyReason: 'no_mappable_concepts' });
      await http().patch(`/api/beauty-guides/${low.id}`).set('Cookie', customer).send({ addConceptKeys: ['highlights'] }).expect(200);
      matches = await http().get(`/api/beauty-guides/${low.id}/matches?lat=35.7&lng=51.4`).set('Cookie', customer).expect(200);
      expect(matches.body.salons).toHaveLength(1);
    });

    it('returns nothing for a different domain with no matching salons', async () => {
      mock.useScenario('nails');
      const nails = (await upload(customer, await inspirationImage()).expect(201)).body;
      const res = await http().get(`/api/beauty-guides/${nails.id}/matches?lat=35.7&lng=51.4`).set('Cookie', customer).expect(200);
      expect(res.body.salons).toEqual([]);
      expect(nailCategoryId).toBeGreaterThan(0);
    });

    it('never lets another user read, edit, match or delete the guide (404)', async () => {
      await http().get(`/api/beauty-guides/${guideId}`).set('Cookie', otherCustomer).expect(404);
      await http().get(`/api/beauty-guides/${guideId}/matches?lat=35.7&lng=51.4`).set('Cookie', otherCustomer).expect(404);
      await http().patch(`/api/beauty-guides/${guideId}`).set('Cookie', otherCustomer).send({ removeConceptKeys: ['root_melt'] }).expect(404);
      await http().delete(`/api/beauty-guides/${guideId}`).set('Cookie', otherCustomer).expect(404);
      const list = await http().get('/api/beauty-guides').set('Cookie', otherCustomer).expect(200);
      expect(list.body.map((g: { id: string }) => g.id)).not.toContain(guideId);
    });

    describe('booking handoff', () => {
      let bookingId: string;
      const startsAt = (hoursAhead: number) => {
        const d = new Date(Date.now() + hoursAhead * 3600_000);
        d.setUTCMinutes(0, 0, 0);
        return d.toISOString();
      };

      it('refuses to attach someone else’s guide', async () => {
        await http().post('/api/bookings').set('Cookie', otherCustomer)
          .send({ salonId, serviceId: fixedServiceId, startsAt: startsAt(48), beautyGuideId: guideId })
          .expect(400);
      });

      it('books through the existing engine with identical money/duration as a booking without a guide', async () => {
        const plain = await http().post('/api/bookings').set('Cookie', otherCustomer)
          .send({ salonId, serviceId: fixedServiceId, startsAt: startsAt(72) })
          .expect(201);
        const withGuide = await http().post('/api/bookings').set('Cookie', customer)
          .send({ salonId, serviceId: fixedServiceId, startsAt: startsAt(96), beautyGuideId: guideId })
          .expect(201);
        bookingId = withGuide.body.booking.id;
        const pick = (b: Record<string, unknown>) => ({
          status: b.status, priceSnapshot: b.priceSnapshot, depositAmount: b.depositAmount,
          durationMs: new Date(b.endsAt as string).getTime() - new Date(b.startsAt as string).getTime(),
        });
        expect(pick(withGuide.body.booking)).toEqual(pick(plain.body.booking));
        // Booking duration is the service's real duration (90 min), never the AI estimate (180-300).
        expect(pick(withGuide.body.booking).durationMs).toBe(90 * 60_000);
        expect(withGuide.body.booking.beautyGuideId).toBe(guideId);
      });

      it('shows the guide to the booked salon only', async () => {
        const res = await http().get(`/api/salons/mine/bookings/${bookingId}/beauty-guide`).set('Cookie', owner).expect(200);
        expect(res.body.id).toBe(guideId);
        expect(res.body.imagePath).toBe(`/salons/mine/bookings/${bookingId}/beauty-guide/image`);
        await http().get(res.body.imagePath.replace(/^/, '/api')).set('Cookie', owner).expect(200);
        // An unrelated salon owner can't see it, even with the right booking id.
        await http().get(`/api/salons/mine/bookings/${bookingId}/beauty-guide`).set('Cookie', otherOwner).expect(404);
        await http().get(`/api/salons/mine/bookings/${bookingId}/beauty-guide/image`).set('Cookie', otherOwner).expect(404);
      });

      it('deleting the guide keeps the booking and removes the private image', async () => {
        const store = app.get<PrivateImageStore>(PRIVATE_IMAGE_STORE);
        const [{ image_key }] = await ds.query(`SELECT image_key FROM beauty_guides WHERE id = $1`, [guideId]);
        await http().delete(`/api/beauty-guides/${guideId}`).set('Cookie', customer).expect(204);
        expect(await store.get(image_key)).toBeNull();
        const [booking] = await ds.query(`SELECT status, beauty_guide_id FROM bookings WHERE id = $1`, [bookingId]);
        expect(booking).toEqual({ status: 'confirmed', beauty_guide_id: null });
        await http().get(`/api/salons/mine/bookings/${bookingId}/beauty-guide`).set('Cookie', owner).expect(404);
      });
    });
  });

  describe('explain this look (from portfolio)', () => {
    it('creates a private guide from a published portfolio image through the same engine', async () => {
      const res = await http().post('/api/salons/mine/portfolio').set('Cookie', owner)
        .field('serviceId', fixedServiceId)
        .attach('file', await inspirationImage(), { filename: 'work.jpg', contentType: 'image/jpeg' })
        .expect(201);
      const guide = await http().post(`/api/beauty-guides/from-portfolio/${res.body.id}`).set('Cookie', customer).expect(201);
      expect(guide.body).toMatchObject({ status: 'ready', sourcePortfolioItemId: res.body.id });
      const [{ image_key }] = await ds.query(`SELECT image_key FROM beauty_guides WHERE id = $1`, [guide.body.id]);
      expect(image_key).toMatch(/^beauty-guides\//);

      const matches = await http().get(`/api/beauty-guides/${guide.body.id}/matches?lat=35.7&lng=51.4`).set('Cookie', customer).expect(200);
      expect(matches.body.portfolio.map((p: { id: string }) => p.id)).toContain(res.body.id);
      expect(matches.body.portfolio[0]).toMatchObject({ salonSlug: salonSlug });
    });

    it('404s for a removed portfolio item', async () => {
      const res = await http().post('/api/salons/mine/portfolio').set('Cookie', owner)
        .attach('file', await inspirationImage(), { filename: 'w.jpg', contentType: 'image/jpeg' })
        .expect(201);
      await ds.query(`UPDATE portfolio_items SET status = 'removed' WHERE id = $1`, [res.body.id]);
      await http().post(`/api/beauty-guides/from-portfolio/${res.body.id}`).set('Cookie', customer).expect(404);
    });
  });

  describe('admin concepts', () => {
    it('lists, creates and updates concepts; non-admins are refused', async () => {
      const list = await http().get('/api/admin/beauty-concepts').set('Cookie', admin).expect(200);
      expect(list.body.length).toBeGreaterThanOrEqual(39);
      await http().get('/api/admin/beauty-concepts').set('Cookie', customer).expect(403);
      const created = await http().post('/api/admin/beauty-concepts').set('Cookie', admin)
        .send({ key: 'hair_tinsel', domain: 'hair_cut_style', nameFa: 'تینسل مو', nameEn: 'Hair Tinsel', categoryId: null, keywords: ['تینسل'] })
        .expect(201);
      await http().post('/api/admin/beauty-concepts').set('Cookie', admin)
        .send({ key: 'hair_tinsel', domain: 'hair_cut_style', nameFa: 'x', nameEn: 'x' })
        .expect(409);
      const updated = await http().patch(`/api/admin/beauty-concepts/${created.body.id}`).set('Cookie', admin)
        .send({ categoryId: colorCategoryId, isActive: false })
        .expect(200);
      expect(updated.body).toMatchObject({ categoryId: colorCategoryId, isActive: false });
      const [audit] = await ds.query(`SELECT action FROM audit_log WHERE action = 'beauty_concept.update'`);
      expect(audit).toBeDefined();
    });
  });

  describe('retention job', () => {
    it('fails stale processing guides and deletes expired ones, sparing guides on upcoming bookings', async () => {
      mock.useScenario('balayage');
      await resetUsage();
      const stale = (await upload(customer, await inspirationImage()).expect(201)).body.id;
      await ds.query(`UPDATE beauty_guides SET status = 'processing', created_at = now() - interval '1 hour' WHERE id = $1`, [stale]);
      const old = (await upload(customer, await inspirationImage()).expect(201)).body.id;
      await ds.query(`UPDATE beauty_guides SET created_at = now() - interval '200 days' WHERE id = $1`, [old]);

      // Old too, but attached to a booking that hasn't happened yet -- the salon may still need it.
      const attached = (await upload(customer, await inspirationImage()).expect(201)).body.id;
      const future = new Date(Date.now() + 120 * 3600_000);
      future.setUTCMinutes(0, 0, 0);
      await http().post('/api/bookings').set('Cookie', customer)
        .send({ salonId, serviceId: fixedServiceId, startsAt: future.toISOString(), beautyGuideId: attached })
        .expect(201);
      await ds.query(`UPDATE beauty_guides SET created_at = now() - interval '200 days' WHERE id = $1`, [attached]);

      const result = await app.get(BeautyGuideRetentionJob).run();
      expect(await ds.query(`SELECT id FROM beauty_guides WHERE id = $1`, [attached])).toHaveLength(1);
      expect(result.staleFailed).toBeGreaterThanOrEqual(1);
      const [staleRow] = await ds.query(`SELECT status, failure_code FROM beauty_guides WHERE id = $1`, [stale]);
      expect(staleRow).toEqual({ status: 'failed', failure_code: 'timeout' });
      expect(await ds.query(`SELECT id FROM beauty_guides WHERE id = $1`, [old])).toEqual([]);
    });
  });
});

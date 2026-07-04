# Reviews & Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer leave a rating + comment for a completed booking, show published reviews (with an optional salon reply) on the salon's public listing, keep `salons.rating_avg`/`rating_count` correct in real time, and give an admin the ability to reject (or reverse-reject) a review.

**Architecture:** A new `reviews` module in the existing NestJS modular monolith, following the exact same file/task shape as the `booking` module from Plan 2 — one entity + migration, then services/controllers grown incrementally task by task, each ending in a real e2e test against Postgres. Reviews are created as `published` immediately (moderation is reactive, per the approved design spec); an admin-only endpoint can flip a review to `rejected` (or back). `salons.rating_avg`/`rating_count` are recomputed from source of truth (`SELECT AVG/COUNT ... WHERE status = 'published'`) inside the same transaction as any status-affecting write, never incremented/decremented in place.

**Tech Stack:** NestJS 11, TypeORM 0.3 (raw SQL migration, `synchronize: false`), PostgreSQL, class-validator DTOs, Jest + Supertest e2e tests — all identical to Plans 1 and 2; no new libraries.

---

## Scope notes (deliberate, from the spec)

- **No "reports" table or in-app reporting UI.** The design spec's data model (§3) lists exactly ten entities and `reviews` is not paired with a `reports`/`flags` table. §7 says "reactive — reviews publish immediately... admins handle reports/flags," but doesn't define an in-app reporting mechanism, and no admin-panel frontend exists yet (still API-only, matching Plans 1–2). This plan builds the admin's ability to reject (and reverse) a review; however a report reaches an admin (phone, email, support ticket) is out of band and out of scope, exactly as Zarinpal refund settlement was left out of band in Plan 2.
- **No "my reviews" listing, no review editing/deletion by the customer.** Not mentioned anywhere in the spec's User App section (§5) — the customer's only touchpoints are: leave a review once, see it (and any salon reply) on the salon's public page. Adding more would be scope creep beyond what's specified.
- **Comment is optional, rating is required.** The spec's entity line ("rating (1–5), comment") doesn't state comment is mandatory; a star-only review is a normal, common review-system pattern and forcing text isn't specified. Rating is always required and validated to an integer 1–5.
- **"One public reply per review" is a single reply slot, not a thread.** The provider panel section (§6) says "one public reply per review" — modeled as a single nullable `salon_reply` column, settable and updatable by the owner (not a append-only list). Editing your own reply is ordinary UX and isn't excluded by the spec.
- **Recompute, don't increment.** `rating_avg`/`rating_count` are always recomputed via `SELECT AVG/COUNT(*) FROM reviews WHERE salon_id = X AND status = 'published'`, never adjusted with `+1`/`-1` arithmetic. This is deliberately simple and correct by construction (no float-drift, no missed edge case), and cheap at MVP scale (at most a few hundred reviews per salon). The design spec's own wording ("rating_avg/rating_count update in the same transaction as review creation (and re-compute on rejection)") already uses the word "re-compute", so this is the spec's own intended approach, not a plan-time invention.
- **First-ever use of `RolesGuard`/`@Roles('admin')` in this codebase.** Plan 1 built the guard and decorator but never wired them into a real endpoint. This plan is the first real integration test of that infrastructure — Task 5's e2e suite is also, incidentally, the first integration coverage `RolesGuard` has ever had.

---

## File Structure

```
apps/api/src/reviews/
├── review.entity.ts              # Review entity (Task 1)
├── reviews.service.ts             # create/findForSalon/addSalonReply/moderate, grown task-by-task
├── reviews.controller.ts          # POST /reviews (Task 2)
├── salon-reviews.controller.ts    # GET /salons/:salonId/reviews, public (Task 3)
├── salon-review-reply.controller.ts # PATCH /salons/mine/reviews/:id/reply (Task 4)
├── admin-reviews.controller.ts    # PATCH /admin/reviews/:id, admin-only (Task 5)
├── reviews.module.ts               # grown task-by-task
└── dto/
    └── review.dto.ts               # CreateReviewDto, SalonReplyDto, ModerateReviewDto

apps/api/src/migrations/
└── 1751800000000-reviews-schema.ts # reviews table (Task 1)

apps/api/test/
└── reviews.e2e-spec.ts             # grown task-by-task, one describe block per task's concerns
```

---

### Task 1: `Review` entity + migration

**Files:**
- Create: `apps/api/src/reviews/review.entity.ts`
- Create: `apps/api/src/migrations/1751800000000-reviews-schema.ts`

- [ ] **Step 1: The entity** — `apps/api/src/reviews/review.entity.ts`

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ReviewStatus = 'published' | 'rejected';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id' })
  bookingId: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'varchar', default: 'published' })
  status: ReviewStatus;

  @Column({ name: 'salon_reply', type: 'text', nullable: true })
  salonReply: string | null;

  @Column({ name: 'salon_reply_at', type: 'timestamptz', nullable: true })
  salonReplyAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: The migration** — `apps/api/src/migrations/1751800000000-reviews-schema.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReviewsSchema1751800000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid NOT NULL REFERENCES bookings(id),
        salon_id uuid NOT NULL REFERENCES salons(id),
        user_id uuid NOT NULL REFERENCES users(id),
        rating int NOT NULL,
        comment text,
        status varchar(20) NOT NULL DEFAULT 'published',
        salon_reply text,
        salon_reply_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    // UNIQUE on booking_id is the actual enforcement of "verified bookings only,
    // one review per completed booking" per the design spec's data-model section --
    // an index (not an inline column constraint) to match this codebase's existing
    // convention for the same shape of constraint (see payments_booking_uidx in
    // 1751700000000-booking-payments-schema.ts).
    await q.query(`CREATE UNIQUE INDEX reviews_booking_uidx ON reviews(booking_id)`);
    // Matches the exact query shape of the public listing endpoint (Task 3):
    // WHERE salon_id = $1 AND status = 'published', ordered by created_at.
    await q.query(`CREATE INDEX reviews_salon_status_idx ON reviews(salon_id, status)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE reviews`);
  }
}
```

- [ ] **Step 3: Verify migrations apply cleanly**

Run: `cd apps/api && npx jest --config test/jest-e2e.json --testPathPattern="health.e2e-spec" --runInBand`
Expected: PASS. This suite's `beforeAll` calls `resetDatabase()`, which drops the schema and reruns every migration including the new one — a clean pass here proves the new migration is syntactically valid and doesn't conflict with the existing schema, without needing a dedicated test of its own (matching the pattern from Plan 2's Task 5, where the entity+migration task had no standalone test — correctness is proven by every later task's e2e suite building on top of it).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/reviews/review.entity.ts apps/api/src/migrations/1751800000000-reviews-schema.ts
git commit -m "feat(api): add Review entity and reviews table migration"
```

---

### Task 2: `ReviewsService.create()` + `POST /reviews`

**Files:**
- Create: `apps/api/src/reviews/dto/review.dto.ts`
- Create: `apps/api/src/reviews/reviews.service.ts`
- Create: `apps/api/src/reviews/reviews.controller.ts`
- Create: `apps/api/src/reviews/reviews.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/reviews.e2e-spec.ts`

- [ ] **Step 1: `CreateReviewDto`** — `apps/api/src/reviews/dto/review.dto.ts`

```typescript
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @IsUUID()
  bookingId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
```

- [ ] **Step 2: `ReviewsService`** — `apps/api/src/reviews/reviews.service.ts`

```typescript
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { CreateReviewDto } from './dto/review.dto';
import { Review } from './review.entity';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
  ) {}

  async create(userId: string, dto: CreateReviewDto): Promise<Review> {
    const booking = await this.bookings.findOneBy({ id: dto.bookingId, userId });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'completed') {
      throw new BadRequestException('Only completed bookings can be reviewed');
    }

    const existing = await this.reviews.findOneBy({ bookingId: dto.bookingId });
    if (existing) throw new ConflictException('This booking has already been reviewed');

    try {
      return await this.dataSource.transaction(async (em) => {
        const review = await em.save(
          Review,
          em.create(Review, {
            bookingId: booking.id,
            salonId: booking.salonId,
            userId,
            rating: dto.rating,
            comment: dto.comment ?? null,
            status: 'published',
          }),
        );
        await this.recomputeSalonRating(em, booking.salonId);
        return review;
      });
    } catch (err) {
      // The pre-check above handles the common case, but the DB's own UNIQUE
      // constraint on booking_id is the actual source of truth (per the design
      // spec: "reviews.booking_id UNIQUE enforces verified-only reviews at the
      // database level") -- a genuinely concurrent double-submit for the same
      // booking can still reach here, so translate that into the same clean
      // 409 rather than leaking a raw Postgres error.
      if (err instanceof QueryFailedError && (err as unknown as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException('This booking has already been reviewed');
      }
      throw err;
    }
  }

  private async recomputeSalonRating(em: EntityManager, salonId: string): Promise<void> {
    // Recomputed from source of truth every time (not incremented/decremented in
    // place) -- avoids float-drift and race-condition bugs, and this exact same
    // query handles a new published review, an admin rejection, and an admin
    // reversal with identical logic. Cheap at MVP scale (at most a few hundred
    // reviews per salon).
    await em.query(
      `UPDATE salons
       SET rating_avg = sub.avg_rating, rating_count = sub.review_count
       FROM (
         SELECT COALESCE(AVG(rating), 0)::numeric(3,2) AS avg_rating, COUNT(*)::int AS review_count
         FROM reviews
         WHERE salon_id = $1 AND status = 'published'
       ) sub
       WHERE salons.id = $1`,
      [salonId],
    );
  }
}
```

- [ ] **Step 3: Controller** — `apps/api/src/reviews/reviews.controller.ts`

```typescript
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
@UseGuards(AuthGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateReviewDto) {
    return this.reviews.create((req.user as User).id, dto);
  }
}
```

- [ ] **Step 4: Module** — `apps/api/src/reviews/reviews.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/booking.entity';
import { Review } from './review.entity';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [TypeOrmModule.forFeature([Review, Booking]), AuthModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
```

- [ ] **Step 5: Register in `app.module.ts`**

Add the import:

```typescript
import { ReviewsModule } from './reviews/reviews.module';
```

Add `ReviewsModule` to `imports`, after `SearchModule` (the last entry):

```typescript
    BookingModule,
    SearchModule,
    ReviewsModule,
```

- [ ] **Step 6: Write the e2e test** — `apps/api/test/reviews.e2e-spec.ts`

This test needs a fully completed booking (booked, paid via the mock gateway callback, then marked `completed` by the owner) before a review can be created — the full chain already proven by Plan 2's own e2e suites.

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Reviews — creation (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09131110001');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Review Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: 1, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09132220002');
  });

  afterAll(async () => {
    await app.close();
  });

  async function bookPayAndComplete(hoursFromNow: number): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(200);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    return created.body.booking.id;
  }

  it('creates a review for a completed booking and recomputes the salon rating', async () => {
    const bookingId = await bookPayAndComplete(24);
    const res = await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 5, comment: 'Great service!' })
      .expect(201);

    expect(res.body.status).toBe('published');
    expect(res.body.rating).toBe(5);
    expect(res.body.comment).toBe('Great service!');

    const ds = app.get(DataSource);
    const [salon] = await ds.query('SELECT rating_avg, rating_count FROM salons WHERE id = $1', [salonId]);
    expect(Number(salon.rating_avg)).toBe(5);
    expect(salon.rating_count).toBe(1);
  });

  it('averages correctly across multiple published reviews', async () => {
    const bookingId = await bookPayAndComplete(48);
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 3 })
      .expect(201);

    const ds = app.get(DataSource);
    const [salon] = await ds.query('SELECT rating_avg, rating_count FROM salons WHERE id = $1', [salonId]);
    expect(Number(salon.rating_avg)).toBe(4); // (5 + 3) / 2
    expect(salon.rating_count).toBe(2);
  });

  it('rejects a review for a booking that is not completed', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString() })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId: created.body.booking.id, rating: 4 })
      .expect(400);
  });

  it('rejects a review for a booking that does not belong to the caller', async () => {
    const bookingId = await bookPayAndComplete(96);
    const stranger = await loginAs(app, '09133330003');
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', stranger)
      .send({ bookingId, rating: 4 })
      .expect(404);
  });

  it('rejects a second review for the same booking', async () => {
    const bookingId = await bookPayAndComplete(120);
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 4 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 2 })
      .expect(409);
  });

  it('rejects an out-of-range rating', async () => {
    const bookingId = await bookPayAndComplete(144);
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 6 })
      .expect(400);
  });

  it('requires auth to create a review', () =>
    request(app.getHttpServer()).post('/api/reviews').send({ bookingId: '00000000-0000-4000-8000-000000000099', rating: 5 }).expect(401));
});
```

- [ ] **Step 7: Run, verify pass**

Run: `cd apps/api && npx jest --config test/jest-e2e.json --testPathPattern="reviews.e2e-spec" --runInBand`
Expected: PASS (7 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/reviews apps/api/src/app.module.ts apps/api/test/reviews.e2e-spec.ts
git commit -m "feat(api): create reviews for completed bookings with rating recompute"
```

---

### Task 3: Public review listing

**Files:**
- Modify: `apps/api/src/reviews/reviews.service.ts` (add `findForSalon`)
- Create: `apps/api/src/reviews/salon-reviews.controller.ts`
- Modify: `apps/api/src/reviews/reviews.module.ts`
- Modify: `apps/api/test/reviews.e2e-spec.ts`

- [ ] **Step 1: Add `findForSalon` to `ReviewsService`**

Append this method to the `ReviewsService` class in `apps/api/src/reviews/reviews.service.ts` (after `create`, before `recomputeSalonRating`):

```typescript

  findForSalon(salonId: string): Promise<Review[]> {
    return this.reviews.find({ where: { salonId, status: 'published' }, order: { createdAt: 'DESC' } });
  }
```

- [ ] **Step 2: Controller** — `apps/api/src/reviews/salon-reviews.controller.ts`

```typescript
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

@Controller('salons/:salonId/reviews')
export class SalonReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Param('salonId', ParseUUIDPipe) salonId: string) {
    return this.reviews.findForSalon(salonId);
  }
}
```

(This route is genuinely public — no guards — matching the salon profile page's need to show reviews to anonymous visitors, the same reasoning already applied to `AvailabilityController` in Plan 2. `salons/:salonId/reviews` is a 3-segment path, provably disjoint from `SalonsController`'s 2-segment `salons/:slug` and from `salons/mine/reviews` — Task 4's route — which differs only in whether segment 2 is a literal or a param, but the two never collide because Task 4's endpoint is a `PATCH` on a 5-segment path (`salons/mine/reviews/:id/reply`), never a bare `GET` on `salons/mine/reviews`.)

- [ ] **Step 3: Register in `reviews.module.ts`**

Add the import and controller:

```typescript
import { SalonReviewsController } from './salon-reviews.controller';
```

```typescript
  controllers: [ReviewsController, SalonReviewsController],
```

- [ ] **Step 4: Extend the e2e test** — append to `apps/api/test/reviews.e2e-spec.ts`

Add this new `describe` block after the closing `});` of the existing `describe('Reviews — creation (e2e)', ...)` block:

```typescript

describe('Reviews — public listing (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09134440004');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Listing Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: 1, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09135550005');
  });

  afterAll(async () => {
    await app.close();
  });

  async function bookPayAndComplete(hoursFromNow: number): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(200);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    return created.body.booking.id;
  }

  it('returns an empty array for a salon with no reviews', async () => {
    const res = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
    expect(res.body).toEqual([]);
  });

  it('lists published reviews without requiring auth', async () => {
    const bookingId = await bookPayAndComplete(24);
    await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId, rating: 4, comment: 'Good' })
      .expect(201);

    const res = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].rating).toBe(4);
    expect(res.body[0].comment).toBe('Good');
  });
});
```

- [ ] **Step 5: Run, verify pass**

Run: `cd apps/api && npx jest --config test/jest-e2e.json --testPathPattern="reviews.e2e-spec" --runInBand`
Expected: PASS (9 tests — 7 from Task 2 plus 2 new).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reviews apps/api/test/reviews.e2e-spec.ts
git commit -m "feat(api): public review listing per salon"
```

---

### Task 4: Salon owner reply

**Files:**
- Modify: `apps/api/src/reviews/dto/review.dto.ts` (add `SalonReplyDto`)
- Modify: `apps/api/src/reviews/reviews.service.ts` (add `addSalonReply`)
- Create: `apps/api/src/reviews/salon-review-reply.controller.ts`
- Modify: `apps/api/src/reviews/reviews.module.ts`
- Modify: `apps/api/test/reviews.e2e-spec.ts`

- [ ] **Step 1: Add `SalonReplyDto`** — append to `apps/api/src/reviews/dto/review.dto.ts`

```typescript

export class SalonReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reply: string;
}
```

Update the file's import line:

```typescript
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
```

- [ ] **Step 2: Add `addSalonReply` to `ReviewsService`**

Append this method to the `ReviewsService` class in `apps/api/src/reviews/reviews.service.ts` (after `findForSalon`, before `recomputeSalonRating`):

```typescript

  async addSalonReply(salonId: string, reviewId: string, reply: string): Promise<Review> {
    const review = await this.reviews.findOneBy({ id: reviewId, salonId });
    if (!review) throw new NotFoundException('Review not found');
    await this.reviews.update({ id: reviewId }, { salonReply: reply, salonReplyAt: new Date() });
    return (await this.reviews.findOneBy({ id: reviewId }))!;
  }
```

- [ ] **Step 3: Controller** — `apps/api/src/reviews/salon-review-reply.controller.ts`

```typescript
import { Body, Controller, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { SalonReplyDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('salons/mine/reviews')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonReviewReplyController {
  constructor(private readonly reviews: ReviewsService) {}

  @Patch(':id/reply')
  reply(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalonReplyDto) {
    return this.reviews.addSalonReply(req.salonId!, id, dto.reply);
  }
}
```

- [ ] **Step 4: Register in `reviews.module.ts`**

Add the `SalonsModule` import (for `SalonOwnerGuard`) alongside the existing `AuthModule` import, and register the new controller:

```typescript
import { SalonsModule } from '../salons/salons.module';
```

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([Review, Booking]), AuthModule, SalonsModule],
  controllers: [ReviewsController, SalonReviewsController, SalonReviewReplyController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
```

- [ ] **Step 5: Extend the e2e test** — append to `apps/api/test/reviews.e2e-spec.ts`

Add this new `describe` block at the end of the file:

```typescript

describe('Reviews — salon owner reply (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let salonId: string;
  let serviceId: string;
  let reviewId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09136660006');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Reply Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: 1, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09137770007');

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(200);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    const reviewRes = await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId: created.body.booking.id, rating: 5 })
      .expect(201);
    reviewId = reviewRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the salon owner reply to a review', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/reviews/${reviewId}/reply`)
      .set('Cookie', ownerCookie)
      .send({ reply: 'Thank you for visiting!' })
      .expect(200);
    expect(res.body.salonReply).toBe('Thank you for visiting!');
    expect(res.body.salonReplyAt).not.toBeNull();
  });

  it('lets the owner update an existing reply', async () => {
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/reviews/${reviewId}/reply`)
      .set('Cookie', ownerCookie)
      .send({ reply: 'Updated reply' })
      .expect(200);

    const res = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
    expect(res.body[0].salonReply).toBe('Updated reply');
  });

  it('rejects a reply from someone who does not own a salon', async () => {
    const stranger = await loginAs(app, '09138880008');
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/reviews/${reviewId}/reply`)
      .set('Cookie', stranger)
      .send({ reply: 'Not mine to reply to' })
      .expect(404);
  });

  it('rejects an empty reply', async () => {
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/reviews/${reviewId}/reply`)
      .set('Cookie', ownerCookie)
      .send({ reply: '' })
      .expect(400);
  });
});
```

- [ ] **Step 6: Run, verify pass**

Run: `cd apps/api && npx jest --config test/jest-e2e.json --testPathPattern="reviews.e2e-spec" --runInBand`
Expected: PASS (13 tests — 9 from Tasks 2-3 plus 4 new).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reviews apps/api/test/reviews.e2e-spec.ts
git commit -m "feat(api): salon owner reply to reviews"
```

---

### Task 5: Admin moderation

**Files:**
- Modify: `apps/api/src/reviews/dto/review.dto.ts` (add `ModerateReviewDto`)
- Modify: `apps/api/src/reviews/reviews.service.ts` (add `moderate`)
- Create: `apps/api/src/reviews/admin-reviews.controller.ts`
- Modify: `apps/api/src/reviews/reviews.module.ts`
- Modify: `apps/api/test/reviews.e2e-spec.ts`

- [ ] **Step 1: Add `ModerateReviewDto`** — append to `apps/api/src/reviews/dto/review.dto.ts`

```typescript

export class ModerateReviewDto {
  @IsIn(['published', 'rejected'])
  status: 'published' | 'rejected';
}
```

Update the file's import line:

```typescript
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
```

- [ ] **Step 2: Add `moderate` to `ReviewsService`**

Append this method to the `ReviewsService` class in `apps/api/src/reviews/reviews.service.ts` (after `addSalonReply`, before `recomputeSalonRating`):

```typescript

  async moderate(reviewId: string, status: 'published' | 'rejected'): Promise<Review> {
    const review = await this.reviews.findOneBy({ id: reviewId });
    if (!review) throw new NotFoundException('Review not found');

    await this.dataSource.transaction(async (em) => {
      await em.update(Review, { id: reviewId }, { status });
      await this.recomputeSalonRating(em, review.salonId);
    });

    return (await this.reviews.findOneBy({ id: reviewId }))!;
  }
```

- [ ] **Step 3: Controller** — `apps/api/src/reviews/admin-reviews.controller.ts`

```typescript
import { Body, Controller, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModerateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('admin/reviews')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Patch(':id')
  moderate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateReviewDto) {
    return this.reviews.moderate(id, dto.status);
  }
}
```

(`AuthGuard` must run before `RolesGuard` — `RolesGuard` reads `user.role` off `req.user`, which only `AuthGuard` populates, the same ordering already established for `SalonOwnerGuard` in Plan 2.)

- [ ] **Step 4: Register in `reviews.module.ts`**

`AuthModule` (already imported) exports both `AuthGuard` and `RolesGuard`, so no new module import is needed — just add the controller:

```typescript
  controllers: [ReviewsController, SalonReviewsController, SalonReviewReplyController, AdminReviewsController],
```

- [ ] **Step 5: Extend the e2e test** — append to `apps/api/test/reviews.e2e-spec.ts`

Add this new `describe` block at the end of the file:

```typescript

describe('Reviews — admin moderation (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let customerCookie: string;
  let adminCookie: string;
  let salonId: string;
  let serviceId: string;
  let reviewId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();

    ownerCookie = await loginAs(app, '09139990009');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Moderation Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 5,
    });
    salonId = salonRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', ownerCookie)
      .send({ categoryId: 1, name: 'Cut', price: 500000, durationMin: 60 });
    serviceId = serviceRes.body.id;

    const ds = app.get(DataSource);
    await ds.query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [salonId]);
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time)
       SELECT $1, generate_series(0, 6), '00:00', '23:00'`,
      [salonId],
    );

    customerCookie = await loginAs(app, '09121010010');

    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .set('Cookie', customerCookie)
      .send({ salonId, serviceId, startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() })
      .expect(201);
    const authority = new URL(created.body.paymentUrl).searchParams.get('Authority')!;
    await request(app.getHttpServer()).get('/api/payments/callback').query({ Authority: authority, Status: 'OK' }).expect(200);
    await request(app.getHttpServer())
      .patch(`/api/salons/mine/bookings/${created.body.booking.id}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'completed' })
      .expect(200);
    const reviewRes = await request(app.getHttpServer())
      .post('/api/reviews')
      .set('Cookie', customerCookie)
      .send({ bookingId: created.body.booking.id, rating: 5 })
      .expect(201);
    reviewId = reviewRes.body.id;

    adminCookie = await loginAs(app, '09122020011');
    const [admin] = await ds.query(`SELECT id FROM users WHERE phone = '09122020011'`);
    await ds.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.id]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects moderation from a non-admin', () =>
    request(app.getHttpServer())
      .patch(`/api/admin/reviews/${reviewId}`)
      .set('Cookie', customerCookie)
      .send({ status: 'rejected' })
      .expect(403));

  it('lets an admin reject a review, excluding it from the salon rating', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/reviews/${reviewId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected' })
      .expect(200);
    expect(res.body.status).toBe('rejected');

    const ds = app.get(DataSource);
    const [salon] = await ds.query('SELECT rating_avg, rating_count FROM salons WHERE id = $1', [salonId]);
    expect(salon.rating_count).toBe(0);

    const listRes = await request(app.getHttpServer()).get(`/api/salons/${salonId}/reviews`).expect(200);
    expect(listRes.body).toEqual([]);
  });

  it('lets an admin reverse a rejection back to published', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/reviews/${reviewId}`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(200);

    const ds = app.get(DataSource);
    const [salon] = await ds.query('SELECT rating_avg, rating_count FROM salons WHERE id = $1', [salonId]);
    expect(salon.rating_count).toBe(1);
    expect(Number(salon.rating_avg)).toBe(5);
  });

  it('404s for a nonexistent review', () =>
    request(app.getHttpServer())
      .patch('/api/admin/reviews/00000000-0000-4000-8000-000000000099')
      .set('Cookie', adminCookie)
      .send({ status: 'rejected' })
      .expect(404));
});
```

- [ ] **Step 6: Run, verify pass**

Run: `cd apps/api && npx jest --config test/jest-e2e.json --testPathPattern="reviews.e2e-spec" --runInBand`
Expected: PASS (17 tests — 13 from Tasks 2-4 plus 4 new).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reviews apps/api/test/reviews.e2e-spec.ts
git commit -m "feat(api): admin review moderation with reactive publish/reject"
```

---

### Task 6: Full-suite verification & docs update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run everything**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e && pnpm build`
Expected: all unit tests PASS (unchanged from Plan 2 — this plan adds no new unit-tested pure functions), all e2e suites PASS, build succeeds. Expected final e2e shape: the 15 suites from Plan 2 plus `reviews.e2e-spec.ts` (16 suites total, 63 + 17 = 80 tests).

- [ ] **Step 2: Update `README.md`**

Add a new section after the existing "## Booking & payments (Plan 2)" section:

```markdown

## Reviews & moderation (Plan 3)

- `POST /api/reviews` — leave a rating (1-5) + optional comment for one of your own completed bookings (customer, authenticated)
- `GET /api/salons/:salonId/reviews` — published reviews for a salon, newest first (public)
- `PATCH /api/salons/mine/reviews/:id/reply` — salon owner sets or updates their one reply to a review (provider, authenticated)
- `PATCH /api/admin/reviews/:id` — admin sets a review's status to `published` or `rejected` (admin-only)

**Reviews are verified-booking-only**, enforced at the database level by a UNIQUE index on `reviews.booking_id` — a booking can only be reviewed once, and only after the salon marks it `completed`.

**Moderation is reactive, not pre-publish**: a review is `published` the instant it's created; there's no queue to clear before it's visible. An admin can later flip it to `rejected` (or back) if a report is upheld — how a report reaches an admin (support ticket, phone call) is outside this system for MVP, same as Zarinpal refund settlement in Plan 2.

`salons.rating_avg`/`rating_count` are always recomputed from every currently-`published` review for that salon, in the same transaction as any status-changing write — never incremented/decremented in place — so a rejection (or reversal) immediately and correctly updates the salon's public rating.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document reviews and moderation endpoints from Plan 3"
```

---

## Self-Review

**Spec coverage:** the design spec's reviews-related requirements are spread across §3 (Data Model), §4 step 6 ("Completion triggers the review prompt — the only entry into the review system"), §5 (salon profile shows "reviews with salon replies"), §6 ("Reviews: read; one public reply per review"), and §7 ("Review moderation: reactive... admins handle reports/flags"). Every one has a task: the `reviews` entity + UNIQUE constraint (Task 1), booking-completion-gated creation (Task 2), public display (Task 3), the owner's single reply (Task 4), and admin-reactive moderation with rating recompute (Task 5). The "no reports table, no in-app reporting UI" and "no customer-side edit/delete" scope cuts are called out explicitly in the Scope Notes section above, mirroring how Plan 2 explicitly flagged its own deliberate cuts (no real Zarinpal refund call, no reminder SMS) rather than leaving them silently unaddressed.

**Placeholder scan:** no TBD/TODO markers; every code block is complete, runnable content, not a description of what to write.

**Type consistency:** `ReviewStatus` (`'published' | 'rejected'`, Task 1) is used identically in the entity, `ReviewsService.moderate`'s parameter type, `ModerateReviewDto.status`, and every e2e test's string literals. `Review`'s field names (`bookingId`, `salonId`, `userId`, `rating`, `comment`, `status`, `salonReply`, `salonReplyAt`, `createdAt`) are referenced identically across `reviews.service.ts`, every controller, and every e2e assertion — no drift between what Task 1 defines and what Tasks 2-5 consume. `SalonOwnerGuard`'s `req.salonId` contract (already proven in Plan 2's `salon-bookings.controller.ts`) is consumed identically by Task 4's `SalonReviewReplyController`. `RolesGuard`/`@Roles('admin')` (defined in Plan 1, unused until now) is consumed exactly as already implemented — no changes to that guard were needed or made.

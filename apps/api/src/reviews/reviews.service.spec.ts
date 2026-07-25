import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { Salon } from '../salons/salon.entity';
import { Worker } from '../salons/worker.entity';
import { Review } from './review.entity';
import { ReviewsService } from './reviews.service';
import { WorkerRating } from './worker-rating.entity';

describe('ReviewsService.findForSalon', () => {
  let service: ReviewsService;
  let reviewsFind: jest.Mock;
  let salonFindOneBy: jest.Mock;

  beforeEach(async () => {
    reviewsFind = jest.fn();
    salonFindOneBy = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: { find: reviewsFind } },
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: salonFindOneBy } },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: getRepositoryToken(WorkerRating), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ReviewsService);
  });

  it('404s when the salon does not exist, without touching the reviews table', async () => {
    salonFindOneBy.mockResolvedValue(null);
    await expect(service.findForSalon('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(reviewsFind).not.toHaveBeenCalled();
  });

  it('404s for a non-approved salon (the lookup itself is scoped to status=approved)', async () => {
    salonFindOneBy.mockResolvedValue(null);
    await expect(service.findForSalon('suspended-salon')).rejects.toBeInstanceOf(NotFoundException);
    expect(salonFindOneBy).toHaveBeenCalledWith({ id: 'suspended-salon', status: 'approved' });
  });

  it('returns published reviews newest-first for an approved salon', async () => {
    salonFindOneBy.mockResolvedValue({ id: 's1', status: 'approved' });
    const rows = [{ id: 'r1' }];
    reviewsFind.mockResolvedValue(rows);
    await expect(service.findForSalon('s1')).resolves.toBe(rows);
    expect(reviewsFind).toHaveBeenCalledWith({
      where: { salonId: 's1', status: 'published' },
      order: { createdAt: 'DESC' },
    });
  });
});

// A fake EntityManager whose `query` routes on a distinctive substring of the SQL
// text, mirroring the real recomputeSalonRating/recomputeWorkerRating call shape
// (lock -> aggregate SELECT -> UPDATE) without depending on call order.
function makeFakeEm(aggregates: { salon?: { avg_rating: string; review_count: number }; worker?: { avg_rating: string; rating_count: number } } = {}) {
  const query = jest.fn((sql: string) => {
    if (sql.includes('FROM reviews')) {
      return Promise.resolve([aggregates.salon ?? { avg_rating: '0.00', review_count: 0 }]);
    }
    if (sql.includes('FROM worker_ratings')) {
      return Promise.resolve([aggregates.worker ?? { avg_rating: '0.00', rating_count: 0 }]);
    }
    return Promise.resolve([{ id: 'locked' }]);
  });
  const save = jest.fn((_cls: unknown, data: Record<string, unknown>) => Promise.resolve({ id: 'generated-id', ...data }));
  const create = jest.fn((_cls: unknown, data: unknown) => data);
  const update = jest.fn().mockResolvedValue({ affected: 1 });
  return { query, save, create, update };
}

describe('ReviewsService.create -- worker rating validation and atomic insert', () => {
  let service: ReviewsService;
  let bookingsFindOneBy: jest.Mock;
  let reviewsFindOneBy: jest.Mock;
  let transaction: jest.Mock;
  let em: ReturnType<typeof makeFakeEm>;

  const COMPLETED_BOOKING = { id: 'booking-1', salonId: 'salon-1', status: 'completed', workerId: null as string | null };

  beforeEach(async () => {
    bookingsFindOneBy = jest.fn();
    reviewsFindOneBy = jest.fn().mockResolvedValue(null);
    em = makeFakeEm({ salon: { avg_rating: '5.00', review_count: 1 }, worker: { avg_rating: '4.00', rating_count: 1 } });
    transaction = jest.fn((cb: (em: unknown) => unknown) => cb(em));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: { findOneBy: reviewsFindOneBy } },
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: getRepositoryToken(WorkerRating), useValue: {} },
        { provide: DataSource, useValue: { transaction } },
        { provide: PlatformConfigService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ReviewsService);
  });

  it('400s when the booking has a worker but no workerRating was submitted', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...COMPLETED_BOOKING, workerId: 'worker-1' });

    await expect(service.create('user-1', { bookingId: 'booking-1', rating: 5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('400s when workerRating was submitted but the booking has no worker', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...COMPLETED_BOOKING, workerId: null });

    await expect(
      service.create('user-1', { bookingId: 'booking-1', rating: 5, workerRating: 4 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('inserts only the Review row (no WorkerRating, no worker recompute) when the booking has no worker', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...COMPLETED_BOOKING, workerId: null });

    await service.create('user-1', { bookingId: 'booking-1', rating: 5 });

    expect(em.save).toHaveBeenCalledTimes(1);
    expect(em.save).toHaveBeenCalledWith(Review, expect.objectContaining({ rating: 5 }));
    expect(em.query).not.toHaveBeenCalledWith(expect.stringContaining('FROM workers'), expect.anything());
  });

  it('inserts Review + WorkerRating atomically and recomputes both aggregates when the booking has a worker', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...COMPLETED_BOOKING, workerId: 'worker-1' });

    const review = await service.create('user-1', { bookingId: 'booking-1', rating: 5, workerRating: 4 });

    expect(em.save).toHaveBeenCalledTimes(2);
    expect(em.save).toHaveBeenNthCalledWith(1, Review, expect.objectContaining({ rating: 5 }));
    expect(em.save).toHaveBeenNthCalledWith(
      2,
      WorkerRating,
      expect.objectContaining({
        reviewId: 'generated-id',
        bookingId: 'booking-1',
        workerId: 'worker-1',
        salonId: 'salon-1',
        userId: 'user-1',
        rating: 4,
        status: 'published',
      }),
    );
    // recomputeSalonRating's lock + aggregate + write, and recomputeWorkerRating's
    // equivalent -- both happened inside the same transaction as the inserts.
    expect(em.query).toHaveBeenCalledWith(expect.stringContaining('FROM salons'), ['salon-1']);
    expect(em.query).toHaveBeenCalledWith(expect.stringContaining('FROM reviews'), ['salon-1']);
    expect(em.query).toHaveBeenCalledWith(expect.stringContaining('FROM workers'), ['worker-1']);
    expect(em.query).toHaveBeenCalledWith(expect.stringContaining('FROM worker_ratings'), ['worker-1']);
    expect(em.query).toHaveBeenCalledWith('UPDATE workers SET rating_avg = $2, rating_count = $3 WHERE id = $1', [
      'worker-1',
      '4.00',
      1,
    ]);
    expect(review.rating).toBe(5);
  });

  it('404s when the booking does not belong to the caller', async () => {
    bookingsFindOneBy.mockResolvedValue(null);
    await expect(service.create('user-1', { bookingId: 'booking-1', rating: 5 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('400s when the booking is not completed', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...COMPLETED_BOOKING, status: 'pending_payment' });
    await expect(service.create('user-1', { bookingId: 'booking-1', rating: 5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('409s when the booking already has a review', async () => {
    bookingsFindOneBy.mockResolvedValue(COMPLETED_BOOKING);
    reviewsFindOneBy.mockResolvedValue({ id: 'existing-review' });
    await expect(service.create('user-1', { bookingId: 'booking-1', rating: 5 })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ReviewsService.update / remove -- ownership and edit-window enforcement', () => {
  let service: ReviewsService;
  let reviewsFindOneBy: jest.Mock;
  let workerRatingsFindOneBy: jest.Mock;
  let getReviewEditWindowHours: jest.Mock;
  let transaction: jest.Mock;
  let em: ReturnType<typeof makeFakeEm>;

  const FIXED_NOW = 1_700_000_000_000;
  const WINDOW_HOURS = 72;
  const WINDOW_MS = WINDOW_HOURS * 60 * 60_000;

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    reviewsFindOneBy = jest.fn();
    workerRatingsFindOneBy = jest.fn().mockResolvedValue(null);
    getReviewEditWindowHours = jest.fn().mockResolvedValue(WINDOW_HOURS);
    em = makeFakeEm();
    transaction = jest.fn((cb: (em: unknown) => unknown) => cb(em));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: { findOneBy: reviewsFindOneBy } },
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: getRepositoryToken(WorkerRating), useValue: { findOneBy: workerRatingsFindOneBy } },
        { provide: DataSource, useValue: { transaction } },
        { provide: PlatformConfigService, useValue: { getReviewEditWindowHours } },
      ],
    }).compile();
    service = moduleRef.get(ReviewsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('404s update() for a nonexistent review', async () => {
    reviewsFindOneBy.mockResolvedValue(null);
    await expect(service.update('user-1', 'review-1', { rating: 4 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403s update() from someone who is not the review owner', async () => {
    reviewsFindOneBy.mockResolvedValue({ id: 'review-1', userId: 'someone-else', status: 'published', createdAt: new Date(FIXED_NOW) });
    await expect(service.update('user-1', 'review-1', { rating: 4 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403s update() on an already-withdrawn review', async () => {
    reviewsFindOneBy.mockResolvedValue({ id: 'review-1', userId: 'user-1', status: 'withdrawn', createdAt: new Date(FIXED_NOW) });
    await expect(service.update('user-1', 'review-1', { rating: 4 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows update() exactly at the edit-window boundary', async () => {
    reviewsFindOneBy.mockResolvedValue({
      id: 'review-1', userId: 'user-1', salonId: 'salon-1', status: 'published',
      createdAt: new Date(FIXED_NOW - WINDOW_MS),
    });

    await expect(service.update('user-1', 'review-1', { rating: 4 })).resolves.toBeDefined();
    expect(em.update).toHaveBeenCalledWith(Review, { id: 'review-1' }, { rating: 4 });
  });

  it('403s update() one millisecond past the edit-window boundary', async () => {
    reviewsFindOneBy.mockResolvedValue({
      id: 'review-1', userId: 'user-1', salonId: 'salon-1', status: 'published',
      createdAt: new Date(FIXED_NOW - WINDOW_MS - 1),
    });

    await expect(service.update('user-1', 'review-1', { rating: 4 })).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('400s update() when workerRating is submitted but the review has no linked WorkerRating', async () => {
    reviewsFindOneBy.mockResolvedValue({
      id: 'review-1', userId: 'user-1', salonId: 'salon-1', status: 'published',
      createdAt: new Date(FIXED_NOW),
    });
    workerRatingsFindOneBy.mockResolvedValue(null);

    await expect(service.update('user-1', 'review-1', { workerRating: 3 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('updates the linked WorkerRating and recomputes both aggregates when workerRating changes', async () => {
    reviewsFindOneBy.mockResolvedValue({
      id: 'review-1', userId: 'user-1', salonId: 'salon-1', status: 'published',
      createdAt: new Date(FIXED_NOW),
    });
    workerRatingsFindOneBy.mockResolvedValue({ id: 'wr-1', workerId: 'worker-1', reviewId: 'review-1' });

    await service.update('user-1', 'review-1', { workerRating: 2 });

    expect(em.update).toHaveBeenCalledWith(WorkerRating, { id: 'wr-1' }, { rating: 2 });
    expect(em.query).toHaveBeenCalledWith(expect.stringContaining('FROM workers'), ['worker-1']);
  });

  it('404s remove() for a nonexistent review', async () => {
    reviewsFindOneBy.mockResolvedValue(null);
    await expect(service.remove('user-1', 'review-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403s remove() from someone who is not the review owner', async () => {
    reviewsFindOneBy.mockResolvedValue({ id: 'review-1', userId: 'someone-else', status: 'published', createdAt: new Date(FIXED_NOW) });
    await expect(service.remove('user-1', 'review-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403s remove() past the edit window', async () => {
    reviewsFindOneBy.mockResolvedValue({
      id: 'review-1', userId: 'user-1', salonId: 'salon-1', status: 'published',
      createdAt: new Date(FIXED_NOW - WINDOW_MS - 1),
    });
    await expect(service.remove('user-1', 'review-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('soft-deletes the review to withdrawn, cascades the linked WorkerRating to rejected, and recomputes both aggregates', async () => {
    reviewsFindOneBy.mockResolvedValue({
      id: 'review-1', userId: 'user-1', salonId: 'salon-1', status: 'published',
      createdAt: new Date(FIXED_NOW),
    });
    workerRatingsFindOneBy.mockResolvedValue({ id: 'wr-1', workerId: 'worker-1', reviewId: 'review-1' });

    await service.remove('user-1', 'review-1');

    expect(em.update).toHaveBeenCalledWith(Review, { id: 'review-1' }, { status: 'withdrawn' });
    expect(em.update).toHaveBeenCalledWith(WorkerRating, { id: 'wr-1' }, { status: 'rejected' });
    expect(em.query).toHaveBeenCalledWith(expect.stringContaining('FROM salons'), ['salon-1']);
    expect(em.query).toHaveBeenCalledWith(expect.stringContaining('FROM workers'), ['worker-1']);
  });

  it('remove() skips the WorkerRating cascade when the review has no linked worker rating', async () => {
    reviewsFindOneBy.mockResolvedValue({
      id: 'review-1', userId: 'user-1', salonId: 'salon-1', status: 'published',
      createdAt: new Date(FIXED_NOW),
    });
    workerRatingsFindOneBy.mockResolvedValue(null);

    await service.remove('user-1', 'review-1');

    expect(em.update).toHaveBeenCalledTimes(1);
    expect(em.update).toHaveBeenCalledWith(Review, { id: 'review-1' }, { status: 'withdrawn' });
  });
});

describe('ReviewsService.moderateWorkerRating', () => {
  let service: ReviewsService;
  let workerRatingsFindOneBy: jest.Mock;
  let transaction: jest.Mock;
  let em: ReturnType<typeof makeFakeEm>;

  beforeEach(async () => {
    workerRatingsFindOneBy = jest.fn();
    em = makeFakeEm({ worker: { avg_rating: '3.50', rating_count: 2 } });
    transaction = jest.fn((cb: (em: unknown) => unknown) => cb(em));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: {} },
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: getRepositoryToken(WorkerRating), useValue: { findOneBy: workerRatingsFindOneBy } },
        { provide: DataSource, useValue: { transaction } },
        { provide: PlatformConfigService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ReviewsService);
  });

  it('404s for a nonexistent worker rating', async () => {
    workerRatingsFindOneBy.mockResolvedValue(null);
    await expect(service.moderateWorkerRating('wr-1', 'rejected')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('flips status and recomputes the worker aggregate from source of truth', async () => {
    workerRatingsFindOneBy.mockResolvedValue({ id: 'wr-1', workerId: 'worker-1' });

    await service.moderateWorkerRating('wr-1', 'rejected');

    expect(em.update).toHaveBeenCalledWith(WorkerRating, { id: 'wr-1' }, { status: 'rejected' });
    expect(em.query).toHaveBeenCalledWith('UPDATE workers SET rating_avg = $2, rating_count = $3 WHERE id = $1', [
      'worker-1',
      '3.50',
      2,
    ]);
  });
});

describe('ReviewsService.moderate -- admin moderation, guarded against a customer-withdrawn review', () => {
  let service: ReviewsService;
  let reviewsFindOneBy: jest.Mock;
  let transaction: jest.Mock;
  let em: ReturnType<typeof makeFakeEm>;

  beforeEach(async () => {
    reviewsFindOneBy = jest.fn();
    em = makeFakeEm({ salon: { avg_rating: '4.20', review_count: 5 } });
    transaction = jest.fn((cb: (em: unknown) => unknown) => cb(em));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: { findOneBy: reviewsFindOneBy } },
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: getRepositoryToken(WorkerRating), useValue: {} },
        { provide: DataSource, useValue: { transaction } },
        { provide: PlatformConfigService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ReviewsService);
  });

  it('404s for a nonexistent review', async () => {
    reviewsFindOneBy.mockResolvedValue(null);
    await expect(service.moderate('missing', 'rejected')).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('flips status and recomputes the salon aggregate for a published/rejected review', async () => {
    reviewsFindOneBy.mockResolvedValueOnce({ id: 'r1', status: 'published', salonId: 'salon-1' }).mockResolvedValueOnce({
      id: 'r1',
      status: 'rejected',
      salonId: 'salon-1',
    });

    await service.moderate('r1', 'rejected');

    expect(em.update).toHaveBeenCalledWith(Review, { id: 'r1' }, { status: 'rejected' });
  });

  // The P0 case: a withdrawn review is the customer's own soft-delete, not an admin
  // moderation state. Nothing an admin PATCHes should be able to flip it back to
  // 'published' (silently resurrecting deleted content) or on to 'rejected'. This must
  // hold regardless of the admin-panel UI's own guard, since it's the actual source of
  // truth for the mutation.
  it('409s attempting to moderate a withdrawn review, in either direction, without touching the transaction', async () => {
    reviewsFindOneBy.mockResolvedValue({ id: 'r1', status: 'withdrawn', salonId: 'salon-1' });

    await expect(service.moderate('r1', 'published')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.moderate('r1', 'rejected')).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('ReviewsService.listForAdmin', () => {
  let service: ReviewsService;
  let reviewsFindAndCount: jest.Mock;
  let salonsFind: jest.Mock;
  let workerRatingsFind: jest.Mock;
  let workersFind: jest.Mock;

  beforeEach(async () => {
    reviewsFindAndCount = jest.fn();
    salonsFind = jest.fn();
    workerRatingsFind = jest.fn().mockResolvedValue([]);
    workersFind = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: { findAndCount: reviewsFindAndCount } },
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: { find: salonsFind } },
        { provide: getRepositoryToken(Worker), useValue: { find: workersFind } },
        { provide: getRepositoryToken(WorkerRating), useValue: { find: workerRatingsFind } },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(ReviewsService);
  });

  it('joins salon name onto every row, including a withdrawn one, when no status filter narrows the query', async () => {
    reviewsFindAndCount.mockResolvedValue([
      [
        { id: 'r1', salonId: 'salon-1', status: 'published' },
        { id: 'r2', salonId: 'salon-1', status: 'withdrawn' },
      ],
      2,
    ]);
    salonsFind.mockResolvedValue([{ id: 'salon-1', name: 'سالن نمونه' }]);

    const result = await service.listForAdmin({});

    // No status filter passed through to the repository -- 'withdrawn' rows are
    // deliberately visible to an operator (transparency), only non-actionable via
    // ModerateReviewButton/moderate()'s own guard, not hidden from the list.
    expect(reviewsFindAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(result.items.map((r) => r.salonName)).toEqual(['سالن نمونه', 'سالن نمونه']);
  });

  it('resolves a salonName filter to matching salon ids via ILIKE before querying reviews', async () => {
    reviewsFindAndCount.mockResolvedValue([[{ id: 'r1', salonId: 'salon-1', status: 'published' }], 1]);
    salonsFind.mockResolvedValueOnce([{ id: 'salon-1' }]).mockResolvedValueOnce([{ id: 'salon-1', name: 'سالن نمونه' }]);

    const result = await service.listForAdmin({ salonName: 'نمونه' });

    expect(reviewsFindAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { salonId: expect.anything() } }),
    );
    expect(result.items[0].salonName).toBe('سالن نمونه');
  });

  it('short-circuits to an empty page when a salonName filter matches no salon, without querying reviews', async () => {
    salonsFind.mockResolvedValueOnce([]);

    const result = await service.listForAdmin({ salonName: 'ناموجود' });

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(reviewsFindAndCount).not.toHaveBeenCalled();
  });

  it('an exact salonId filter takes precedence over salonName when both are present', async () => {
    reviewsFindAndCount.mockResolvedValue([[], 0]);

    await service.listForAdmin({ salonId: 'salon-1', salonName: 'ignored' });

    expect(reviewsFindAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: { salonId: 'salon-1' } }));
    // salonName-resolution branch never runs -- salons.find is only called for it, never
    // for display batching here since there are zero result rows.
    expect(salonsFind).not.toHaveBeenCalled();
  });
});

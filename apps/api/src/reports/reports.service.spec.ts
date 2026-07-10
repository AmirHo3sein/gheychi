import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, QueryFailedError } from 'typeorm';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { Booking } from '../booking/booking.entity';
import { Review } from '../reviews/review.entity';
import { CreateReportDto } from './dto/report.dto';
import { Report } from './report.entity';
import { ReportsService } from './reports.service';

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
  reportsRepo: {
    findOneBy: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  reviewsRepo: { findOneBy: jest.Mock };
  bookingsRepo: { countBy: jest.Mock };
  em: { create: jest.Mock; save: jest.Mock };
  transaction: jest.Mock;
  emit: jest.Mock;
  qb: QueryBuilderMock;
}

async function setup(): Promise<{ service: ReportsService; mocks: Mocks }> {
  const em = {
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => values),
    save: jest.fn(async (_entity: unknown, values: Record<string, unknown>) => ({
      id: 'report-1',
      createdAt: new Date(),
      ...values,
    })),
  };
  const qb = {} as QueryBuilderMock;
  for (const method of ['leftJoin', 'select', 'addSelect', 'andWhere', 'orderBy', 'offset', 'limit'] as const) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue([]);

  const mocks: Mocks = {
    reportsRepo: {
      findOneBy: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    },
    reviewsRepo: { findOneBy: jest.fn() },
    bookingsRepo: { countBy: jest.fn() },
    em,
    transaction: jest.fn(async (cb: (em: unknown) => Promise<unknown>) => cb(em)),
    emit: jest.fn().mockResolvedValue(undefined),
    qb,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ReportsService,
      { provide: getRepositoryToken(Report), useValue: mocks.reportsRepo },
      { provide: getRepositoryToken(Review), useValue: mocks.reviewsRepo },
      { provide: getRepositoryToken(Booking), useValue: mocks.bookingsRepo },
      { provide: DataSource, useValue: { transaction: mocks.transaction } },
      { provide: AdminNotificationsService, useValue: { emit: mocks.emit } },
    ],
  }).compile();

  return { service: moduleRef.get(ReportsService), mocks };
}

describe('ReportsService.canReport', () => {
  it('is true when the caller has at least one completed booking at the salon', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);

    await expect(service.canReport('user-1', 'salon-1')).resolves.toBe(true);
    expect(mocks.bookingsRepo.countBy).toHaveBeenCalledWith({
      userId: 'user-1',
      salonId: 'salon-1',
      status: 'completed',
    });
  });

  it('is false when the caller has no completed booking there', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(0);

    await expect(service.canReport('user-1', 'salon-1')).resolves.toBe(false);
  });
});

describe('ReportsService.create', () => {
  it('creates an open salon-targeted report for an eligible customer', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(2);

    const report = await service.create('user-1', { salonId: 'salon-1', reason: 'سالن تمیز نبود و رزرو رعایت نشد' });

    expect(report.id).toBe('report-1');
    expect(mocks.em.save).toHaveBeenCalledWith(Report, {
      reporterId: 'user-1',
      salonId: 'salon-1',
      reviewId: null,
      reason: 'سالن تمیز نبود و رزرو رعایت نشد',
      status: 'open',
    });
  });

  it('derives the salon from the review when reviewId is the target', async () => {
    const { service, mocks } = await setup();
    mocks.reviewsRepo.findOneBy.mockResolvedValue({ id: 'review-9', salonId: 'salon-9' });
    mocks.bookingsRepo.countBy.mockResolvedValue(1);

    await service.create('user-1', { reviewId: 'review-9', reason: 'این دیدگاه توهین‌آمیز است' });

    expect(mocks.bookingsRepo.countBy).toHaveBeenCalledWith({
      userId: 'user-1',
      salonId: 'salon-9',
      status: 'completed',
    });
    expect(mocks.em.save).toHaveBeenCalledWith(
      Report,
      expect.objectContaining({ salonId: 'salon-9', reviewId: 'review-9' }),
    );
  });

  it('404s when the reported review does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.reviewsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.create('user-1', { reviewId: 'review-9', reason: 'این دیدگاه توهین‌آمیز است' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('403s an ineligible reporter with the Farsi eligibility message', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(0);

    await expect(service.create('user-1', { salonId: 'salon-1', reason: 'اطلاعات سالن نادرست است' })).rejects.toMatchObject({
      constructor: ForbiddenException,
      message: 'فقط مشتریانی که نوبت تکمیل‌شده در این سالن داشته‌اند می‌توانند گزارش ثبت کنند',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('400s when both salonId and reviewId are provided', async () => {
    const { service, mocks } = await setup();

    await expect(
      service.create('user-1', { salonId: 'salon-1', reviewId: 'review-9', reason: 'هر دو هدف با هم' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('400s when neither salonId nor reviewId is provided', async () => {
    const { service, mocks } = await setup();

    await expect(service.create('user-1', { reason: 'بدون هدف مشخص' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('treats an empty-string reviewId as absent and creates a salon report with reviewId null', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);

    await service.create('user-1', { salonId: 'salon-1', reviewId: '', reason: 'سالن تمیز نبود و رزرو رعایت نشد' });

    expect(mocks.reviewsRepo.findOneBy).not.toHaveBeenCalled();
    expect(mocks.em.save).toHaveBeenCalledWith(
      Report,
      expect.objectContaining({ salonId: 'salon-1', reviewId: null }),
    );
  });

  it('treats an empty-string salonId as absent and derives the salon from the review', async () => {
    const { service, mocks } = await setup();
    mocks.reviewsRepo.findOneBy.mockResolvedValue({ id: 'review-9', salonId: 'salon-9' });
    mocks.bookingsRepo.countBy.mockResolvedValue(1);

    await service.create('user-1', { salonId: '', reviewId: 'review-9', reason: 'این دیدگاه توهین‌آمیز است' });

    expect(mocks.em.save).toHaveBeenCalledWith(
      Report,
      expect.objectContaining({ salonId: 'salon-9', reviewId: 'review-9' }),
    );
  });

  it('treats a numeric reviewId as absent and creates a salon-only report', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);

    await service.create('user-1', {
      salonId: 'salon-1',
      reviewId: 12345 as unknown as string,
      reason: 'سالن تمیز نبود و رزرو رعایت نشد',
    });

    expect(mocks.reviewsRepo.findOneBy).not.toHaveBeenCalled();
    expect(mocks.em.save).toHaveBeenCalledWith(
      Report,
      expect.objectContaining({ salonId: 'salon-1', reviewId: null }),
    );
  });

  it('400s with the Farsi exactly-one message when both targets are empty strings', async () => {
    const { service, mocks } = await setup();

    await expect(service.create('user-1', { salonId: '', reviewId: '', reason: 'بدون هدف مشخص' })).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'دقیقاً یکی از سالن یا دیدگاه باید به‌عنوان هدف گزارش مشخص شود',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('translates the partial-unique-index violation into a Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);
    const dup = new QueryFailedError('INSERT', [], new Error('duplicate key'));
    Object.assign(dup, { code: '23505' });
    mocks.em.save.mockRejectedValue(dup);

    await expect(service.create('user-1', { salonId: 'salon-1', reason: 'گزارش تکراری برای همین سالن' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'گزارش قبلی شما هنوز در حال بررسی است',
    });
  });

  it('rethrows non-unique-violation errors untouched', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);
    mocks.em.save.mockRejectedValue(new Error('connection reset'));

    await expect(service.create('user-1', { salonId: 'salon-1', reason: 'اطلاعات سالن نادرست است' })).rejects.toThrow(
      'connection reset',
    );
  });
});

describe('CreateReportDto', () => {
  it('fails validation when neither target is provided', async () => {
    const dto = plainToInstance(CreateReportDto, { reason: 'اطلاعات سالن نادرست است' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(expect.arrayContaining(['salonId', 'reviewId']));
  });

  it('passes with only a salonId', async () => {
    const dto = plainToInstance(CreateReportDto, {
      salonId: '2c4b8f9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      reason: 'اطلاعات سالن نادرست است',
    });
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('passes with only a reviewId', async () => {
    const dto = plainToInstance(CreateReportDto, {
      reviewId: '2c4b8f9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      reason: 'این دیدگاه توهین‌آمیز است',
    });
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('fails on a reason shorter than 5 characters', async () => {
    const dto = plainToInstance(CreateReportDto, {
      salonId: '2c4b8f9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      reason: 'کوتاه',  // 5 chars — boundary passes; test the real failure below
    });
    const short = plainToInstance(CreateReportDto, {
      salonId: '2c4b8f9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
      reason: 'بد',
    });
    await expect(validate(dto)).resolves.toEqual([]);
    const errors = await validate(short);
    expect(errors.map((e) => e.property)).toContain('reason');
  });
});

describe('ReportsService.listForAdmin', () => {
  it('defaults to the open queue with the standard envelope', async () => {
    const { service, mocks } = await setup();
    mocks.qb.getRawMany.mockResolvedValue([{ id: 'report-1', salonName: 'Salon A' }]);
    mocks.reportsRepo.count.mockResolvedValue(1);

    const result = await service.listForAdmin({});

    expect(result).toEqual({ items: [{ id: 'report-1', salonName: 'Salon A' }], total: 1, page: 1, pageSize: 20 });
    expect(mocks.qb.andWhere).toHaveBeenCalledWith('report.status = :status', { status: 'open' });
    expect(mocks.reportsRepo.count).toHaveBeenCalledWith({ where: { status: 'open' } });
    expect(mocks.qb.offset).toHaveBeenCalledWith(0);
    expect(mocks.qb.limit).toHaveBeenCalledWith(20);
  });

  it('skips the status filter for status=all and applies the salon filter', async () => {
    const { service, mocks } = await setup();

    await service.listForAdmin({ status: 'all', salonId: 'salon-1', page: 2, pageSize: 10 });

    expect(mocks.qb.andWhere).not.toHaveBeenCalledWith('report.status = :status', expect.anything());
    expect(mocks.qb.andWhere).toHaveBeenCalledWith('report.salonId = :salonId', { salonId: 'salon-1' });
    expect(mocks.reportsRepo.count).toHaveBeenCalledWith({ where: { salonId: 'salon-1' } });
    expect(mocks.qb.offset).toHaveBeenCalledWith(10);
    expect(mocks.qb.limit).toHaveBeenCalledWith(10);
  });
});

describe('ReportsService.resolve', () => {
  it('stamps resolver, note, and time via a conditional update on the open status', async () => {
    const { service, mocks } = await setup();
    mocks.reportsRepo.findOneBy
      .mockResolvedValueOnce({ id: 'report-1', status: 'open' })
      .mockResolvedValueOnce({ id: 'report-1', status: 'resolved', resolvedBy: 'admin-1' });
    mocks.reportsRepo.update.mockResolvedValue({ affected: 1 });

    const result = await service.resolve('admin-1', 'report-1', { status: 'resolved', note: 'بررسی شد' });

    expect(mocks.reportsRepo.update).toHaveBeenCalledWith(
      { id: 'report-1', status: 'open' },
      expect.objectContaining({
        status: 'resolved',
        resolutionNote: 'بررسی شد',
        resolvedBy: 'admin-1',
        resolvedAt: expect.any(Date),
      }),
    );
    expect(result.status).toBe('resolved');
  });

  it('stores a null note when none is given', async () => {
    const { service, mocks } = await setup();
    mocks.reportsRepo.findOneBy
      .mockResolvedValueOnce({ id: 'report-1', status: 'open' })
      .mockResolvedValueOnce({ id: 'report-1', status: 'dismissed' });
    mocks.reportsRepo.update.mockResolvedValue({ affected: 1 });

    await service.resolve('admin-1', 'report-1', { status: 'dismissed' });

    expect(mocks.reportsRepo.update).toHaveBeenCalledWith(
      { id: 'report-1', status: 'open' },
      expect.objectContaining({ resolutionNote: null }),
    );
  });

  it('404s when the report does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.reportsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.resolve('admin-1', 'missing', { status: 'resolved' })).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.reportsRepo.update).not.toHaveBeenCalled();
  });

  it('409s when a concurrent admin already closed the report', async () => {
    const { service, mocks } = await setup();
    mocks.reportsRepo.findOneBy.mockResolvedValue({ id: 'report-1', status: 'open' });
    mocks.reportsRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.resolve('admin-1', 'report-1', { status: 'resolved' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این گزارش قبلاً بررسی شده است',
    });
  });
});

describe('ReportsService.create — report_created notification', () => {
  it('emits report_created through the same transaction manager as the insert', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);

    await service.create('user-1', { salonId: 'salon-1', reason: 'سالن تمیز نبود و رزرو رعایت نشد' });

    expect(mocks.emit).toHaveBeenCalledWith(
      'report_created',
      'گزارش جدید ثبت شد',
      'سالن تمیز نبود و رزرو رعایت نشد',
      '/reports',
      mocks.em,
    );
  });

  it('propagates an emit failure so the transaction rolls the report back', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(1);
    mocks.emit.mockRejectedValue(new Error('notification insert failed'));

    await expect(service.create('user-1', { salonId: 'salon-1', reason: 'اطلاعات سالن نادرست است' })).rejects.toThrow(
      'notification insert failed',
    );
  });

  it('does not emit when the reporter is ineligible', async () => {
    const { service, mocks } = await setup();
    mocks.bookingsRepo.countBy.mockResolvedValue(0);

    await expect(service.create('user-1', { salonId: 'salon-1', reason: 'اطلاعات سالن نادرست است' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

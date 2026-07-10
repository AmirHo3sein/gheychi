import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Booking } from '../booking/booking.entity';
import { Salon } from '../salons/salon.entity';
import { Review } from './review.entity';
import { ReviewsService } from './reviews.service';

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
        { provide: DataSource, useValue: {} },
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

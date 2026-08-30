import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CrmService } from './crm.service';
import { CustomerNote } from './customer-note.entity';

describe('CrmService', () => {
  let service: CrmService;
  let dataSourceQuery: jest.Mock;
  let notesRepo: { find: jest.Mock; create: jest.Mock; save: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    dataSourceQuery = jest.fn();
    notesRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve({ id: 'note-1', ...v })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CrmService,
        { provide: DataSource, useValue: { query: dataSourceQuery } },
        { provide: getRepositoryToken(CustomerNote), useValue: notesRepo },
      ],
    }).compile();
    service = moduleRef.get(CrmService);
  });

  describe('listCustomers', () => {
    it('maps aggregated rows and derives the segment from booking count and recency', async () => {
      const recent = new Date().toISOString();
      dataSourceQuery.mockResolvedValueOnce([
        { user_id: 'u1', name: 'Ali', phone: '0912', bookings_count: '1', completed_count: '1', last_visit_at: recent, gross_value: '300000' },
        { user_id: 'u2', name: 'Sara', phone: '0913', bookings_count: '3', completed_count: '2', last_visit_at: recent, gross_value: '900000' },
        {
          user_id: 'u3', name: 'Reza', phone: '0914', bookings_count: '4', completed_count: '4',
          last_visit_at: new Date(Date.now() - 90 * 86_400_000).toISOString(), gross_value: '1200000',
        },
      ]);

      const result = await service.listCustomers('salon-1');

      expect(result[0]).toMatchObject({ userId: 'u1', bookingsCount: 1, segment: 'new' });
      expect(result[1]).toMatchObject({ userId: 'u2', bookingsCount: 3, segment: 'returning' });
      expect(result[2]).toMatchObject({ userId: 'u3', bookingsCount: 4, segment: 'lapsed' });
    });

    it('scopes the query to the given salon only', async () => {
      dataSourceQuery.mockResolvedValueOnce([]);
      await service.listCustomers('salon-42');
      expect(dataSourceQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE b.salon_id = $1'), ['salon-42']);
    });
  });

  describe('getCustomerDetail', () => {
    it('404s when the customer has no booking at this salon (ownership isolation)', async () => {
      dataSourceQuery.mockResolvedValueOnce([]); // bookings query returns nothing
      await expect(service.getCustomerDetail('salon-1', 'stranger')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the customer, their booking history, and notes', async () => {
      dataSourceQuery
        .mockResolvedValueOnce([
          { id: 'b1', starts_at: '2026-08-01T10:00:00.000Z', status: 'completed', price_snapshot: '300000', service_name: 'کوتاهی مو' },
        ])
        .mockResolvedValueOnce([{ id: 'u1', name: 'Ali', phone: '0912' }]);
      notesRepo.find.mockResolvedValueOnce([{ id: 'n1', note: 'مشتری خوب' }]);

      const result = await service.getCustomerDetail('salon-1', 'u1');

      expect(result.customer).toEqual({ id: 'u1', name: 'Ali', phone: '0912' });
      expect(result.bookings).toEqual([
        { id: 'b1', startsAt: '2026-08-01T10:00:00.000Z', status: 'completed', priceSnapshot: 300000, serviceName: 'کوتاهی مو' },
      ]);
      expect(result.notes).toEqual([{ id: 'n1', note: 'مشتری خوب' }]);
    });
  });

  describe('addNote', () => {
    it('404s when the customer does not belong to this salon', async () => {
      dataSourceQuery.mockResolvedValueOnce([]); // ownership check finds nothing
      await expect(service.addNote('salon-1', 'stranger', 'owner-1', 'یادداشت')).rejects.toBeInstanceOf(NotFoundException);
      expect(notesRepo.save).not.toHaveBeenCalled();
    });

    it('saves the note once ownership is confirmed', async () => {
      dataSourceQuery.mockResolvedValueOnce([{ '?column?': 1 }]);
      await service.addNote('salon-1', 'u1', 'owner-1', 'یادداشت خوب');
      expect(notesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ salonId: 'salon-1', customerId: 'u1', createdBy: 'owner-1', note: 'یادداشت خوب' }),
      );
    });
  });

  describe('deleteNote', () => {
    it('404s when no matching note is found (wrong salon/customer/id)', async () => {
      notesRepo.delete.mockResolvedValueOnce({ affected: 0 });
      await expect(service.deleteNote('salon-1', 'u1', 'note-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes scoped to salon+customer+id, never just the raw note id', async () => {
      await service.deleteNote('salon-1', 'u1', 'note-1');
      expect(notesRepo.delete).toHaveBeenCalledWith({ id: 'note-1', salonId: 'salon-1', customerId: 'u1' });
    });
  });

  describe('getDashboardSummary', () => {
    it('computes estimatedSalonRevenue as grossBookingValue minus commission, distinct from onlineCollected', async () => {
      dataSourceQuery
        .mockResolvedValueOnce([{ gross: '5000000', bookings_count: '10' }])
        .mockResolvedValueOnce([{ collected: '1000000' }])
        .mockResolvedValueOnce([{ commission: '100000' }]);

      const from = new Date('2026-08-01T00:00:00.000Z');
      const to = new Date('2026-08-31T00:00:00.000Z');
      const result = await service.getDashboardSummary('salon-1', from, to);

      expect(result).toEqual({
        from: from.toISOString(),
        to: to.toISOString(),
        bookingsCount: 10,
        grossBookingValue: 5_000_000,
        onlineCollected: 1_000_000,
        commission: 100_000,
        estimatedSalonRevenue: 4_900_000,
      });
    });
  });
});

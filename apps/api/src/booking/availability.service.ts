import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { SalonService } from '../salons/salon-service.entity';
import { ScheduleException } from '../salons/schedule-exception.entity';
import { WorkerEligibilityService } from '../salons/worker-eligibility.service';
import { WorkingHour } from '../salons/working-hour.entity';
import { Salon } from '../salons/salon.entity';
import { Booking, SLOT_BLOCKING_STATUSES } from './booking.entity';
import { computeAvailableSlots, DateException, DayAvailability, WorkingHourRange } from './availability.util';

const AVAILABILITY_WINDOW_DAYS = 14;

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(ScheduleException) private readonly exceptions: Repository<ScheduleException>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly workerEligibility: WorkerEligibilityService,
  ) {}

  async computeFor(
    salonId: string,
    serviceId: string,
    now: Date = new Date(),
    workerId?: string,
  ): Promise<DayAvailability[]> {
    const salon = await this.salons.findOneBy({ id: salonId, status: 'approved' });
    if (!salon) throw new NotFoundException('Salon not found');

    const service = await this.services.findOneBy({ id: serviceId, salonId, isActive: true });
    if (!service) throw new NotFoundException('Service not found');

    if (workerId) {
      // A worker ineligible for this service can never actually be booked into it (see
      // createHold's own check) -- surfacing slots here that would just fail at hold time
      // would be misleading, so this preview short-circuits to "no availability" instead.
      const eligible = await this.workerEligibility.isWorkerEligibleForService(workerId, serviceId);
      if (!eligible) return [];
    }

    const windowEnd = new Date(now.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60_000);

    const [hourRows, exceptionRows, workerExceptionRows, activeBookingRows] = await Promise.all([
      this.hours.find({ where: { salonId } }),
      // Whole-salon closures only -- a per-worker row here would incorrectly close the
      // ENTIRE salon; those are fetched separately below and only ever narrow a single
      // worker's own availability inside the requestedWorkerId branch.
      this.exceptions.find({ where: { salonId, isClosed: true, workerId: IsNull() } }),
      this.exceptions.find({ where: { salonId, isClosed: true, workerId: Not(IsNull()) } }),
      this.bookings.find({
        where: {
          salonId,
          status: In(SLOT_BLOCKING_STATUSES),
          startsAt: LessThan(windowEnd),
          endsAt: MoreThan(now),
        },
      }),
    ]);

    const hoursByWeekday = new Map<number, WorkingHourRange[]>();
    for (const h of hourRows) {
      const existing = hoursByWeekday.get(h.weekday) ?? [];
      existing.push({ openTime: h.openTime, closeTime: h.closeTime });
      hoursByWeekday.set(h.weekday, existing);
    }

    const exceptionsByDate = new Map<string, DateException>();
    for (const e of exceptionRows) {
      exceptionsByDate.set(e.date, e.startTime === null || e.endTime === null ? 'whole-day' : { startTime: e.startTime, endTime: e.endTime });
    }

    // Only ever consulted inside computeAvailableSlots's requestedWorkerId branch --
    // "any available worker" mode never narrows by a specific worker's own days off.
    const workerOffDates = new Map<string, Set<string>>();
    for (const e of workerExceptionRows) {
      if (!e.workerId) continue;
      const existing = workerOffDates.get(e.workerId) ?? new Set<string>();
      existing.add(e.date);
      workerOffDates.set(e.workerId, existing);
    }

    return computeAvailableSlots({
      now,
      days: AVAILABILITY_WINDOW_DAYS,
      durationMin: service.durationMin,
      capacity: salon.capacity,
      hoursByWeekday,
      exceptionsByDate,
      existingBookings: activeBookingRows.map((b) => ({
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        workerId: b.workerId,
      })),
      requestedWorkerId: workerId,
      workerOffDates,
    });
  }
}

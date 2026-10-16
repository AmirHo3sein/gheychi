import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { iranDateString, iranWallClockToInstant } from '../common/iran-time.util';
import { Salon } from '../salons/salon.entity';
import { ScheduleException } from '../salons/schedule-exception.entity';
import { WorkingHour } from '../salons/working-hour.entity';
import { DateException, WorkingHourRange } from './availability.util';
import { Booking, SLOT_BLOCKING_STATUSES } from './booking.entity';
import { addDays, computeDailyCapacity, DayCapacity, daysBetween } from './capacity.util';

export const CAPACITY_DEFAULT_DAYS = 7;
export const CAPACITY_MAX_DAYS = 31;

export interface SalonCapacity {
  from: string; // inclusive, Iran-local date
  to: string; // exclusive, Iran-local date
  capacity: number; // the salon's concurrent-chair setting the minutes are multiplied by
  days: DayCapacity[];
  totals: {
    openMinutes: number;
    capacityMinutes: number;
    bookedMinutes: number;
    freeMinutes: number;
    freePercent: number | null;
  };
}

/**
 * Backs GET /salons/mine/capacity -- the provider dashboard's "free chair-time" figure.
 * Same three loaders AvailabilityService.computeFor runs (working hours, whole-salon
 * exceptions, slot-blocking bookings), but over Tehran calendar days instead of a
 * service's slot grid; see capacity.util.ts for the arithmetic.
 */
@Injectable()
export class SalonCapacityService {
  constructor(
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(ScheduleException) private readonly exceptions: Repository<ScheduleException>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
  ) {}

  async compute(salonId: string, query: { from?: string; to?: string }, now: Date = new Date()): Promise<SalonCapacity> {
    const from = query.from ?? iranDateString(now);
    const to = query.to ?? addDays(from, CAPACITY_DEFAULT_DAYS);
    const span = daysBetween(from, to);
    if (span <= 0) throw new BadRequestException('بازهٔ زمانی نامعتبر است: «از» باید پیش از «تا» باشد');
    if (span > CAPACITY_MAX_DAYS) throw new BadRequestException(`بازهٔ زمانی حداکثر ${CAPACITY_MAX_DAYS} روز است`);

    const salon = await this.salons.findOneBy({ id: salonId });
    if (!salon) throw new NotFoundException('Salon not found');

    const windowStart = iranWallClockToInstant(from, 0);
    const windowEnd = iranWallClockToInstant(to, 0);
    const [hourRows, exceptionRows, bookingRows] = await Promise.all([
      this.hours.find({ where: { salonId } }),
      this.exceptions.find({ where: { salonId, isClosed: true, workerId: IsNull() } }),
      this.bookings.find({
        select: { id: true, startsAt: true, endsAt: true },
        where: {
          salonId,
          status: In(SLOT_BLOCKING_STATUSES),
          startsAt: LessThan(windowEnd),
          endsAt: MoreThan(windowStart),
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

    const dates = Array.from({ length: span }, (_, i) => addDays(from, i));
    const days = computeDailyCapacity({
      dates,
      capacity: salon.capacity,
      hoursByWeekday,
      exceptionsByDate,
      bookings: bookingRows.map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt })),
    });

    const sum = (pick: (d: DayCapacity) => number) => days.reduce((acc, d) => acc + pick(d), 0);
    const capacityMinutes = sum((d) => d.capacityMinutes);
    const freeMinutes = sum((d) => d.freeMinutes);
    return {
      from,
      to,
      capacity: salon.capacity,
      days,
      totals: {
        openMinutes: sum((d) => d.openMinutes),
        capacityMinutes,
        bookedMinutes: sum((d) => d.bookedMinutes),
        freeMinutes,
        freePercent: capacityMinutes > 0 ? Math.round((freeMinutes / capacityMinutes) * 100) : null,
      },
    };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { SalonService } from '../salons/salon-service.entity';
import { ScheduleException } from '../salons/schedule-exception.entity';
import { WorkingHour } from '../salons/working-hour.entity';
import { Salon } from '../salons/salon.entity';
import { Booking } from './booking.entity';
import { computeAvailableSlots, DayAvailability, WorkingHourRange } from './availability.util';

const AVAILABILITY_WINDOW_DAYS = 14;

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(ScheduleException) private readonly exceptions: Repository<ScheduleException>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
  ) {}

  async computeFor(salonId: string, serviceId: string, now: Date = new Date()): Promise<DayAvailability[]> {
    const salon = await this.salons.findOneBy({ id: salonId, status: 'approved' });
    if (!salon) throw new NotFoundException('Salon not found');

    const service = await this.services.findOneBy({ id: serviceId, salonId, isActive: true });
    if (!service) throw new NotFoundException('Service not found');

    const windowEnd = new Date(now.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60_000);

    const [hourRows, exceptionRows, activeBookingRows] = await Promise.all([
      this.hours.find({ where: { salonId } }),
      this.exceptions.find({ where: { salonId, isClosed: true } }),
      this.bookings.find({
        where: {
          salonId,
          status: In(['confirmed', 'pending_payment']),
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

    return computeAvailableSlots({
      now,
      days: AVAILABILITY_WINDOW_DAYS,
      durationMin: service.durationMin,
      capacity: salon.capacity,
      hoursByWeekday,
      closedDates: new Set(exceptionRows.map((e) => e.date)),
      existingBookings: activeBookingRows.map((b) => ({
        startsAt: b.startsAt,
        endsAt: b.endsAt,
      })),
    });
  }
}

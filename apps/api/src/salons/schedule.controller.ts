import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource, Repository } from 'typeorm';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { CreateExceptionDto, ReplaceHoursDto } from './dto/schedule.dto';
import { findOverlappingHourRanges } from './schedule-hours.util';
import { SalonOwnerGuard } from './salon-owner.guard';
import { ScheduleException } from './schedule-exception.entity';
import { Worker } from './worker.entity';
import { WorkingHour } from './working-hour.entity';

@Controller('salons/mine')
@UseGuards(SalonOwnerGuard)
export class ScheduleController {
  constructor(
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(ScheduleException) private readonly exceptions: Repository<ScheduleException>,
    @InjectRepository(Worker) private readonly workers: Repository<Worker>,
    private readonly dataSource: DataSource,
  ) {}

  @Put('hours')
  async replaceHours(@Req() req: Request, @Body() dto: ReplaceHoursDto) {
    for (const h of dto.hours) {
      if (h.openTime >= h.closeTime) {
        throw new BadRequestException(`openTime must be before closeTime (weekday ${h.weekday})`);
      }
    }
    const overlap = findOverlappingHourRanges(dto.hours);
    if (overlap) {
      const [a, b] = overlap;
      throw new BadRequestException(
        `Overlapping working hours on weekday ${a.weekday}: ${a.openTime}-${a.closeTime} and ${b.openTime}-${b.closeTime}`,
      );
    }
    const salonId = req.salonId!;
    return this.dataSource.transaction(async (em) => {
      await em.delete(WorkingHour, { salonId });
      return em.save(WorkingHour, dto.hours.map((h) => ({ ...h, salonId })));
    });
  }

  @Get('hours')
  async listHours(@Req() req: Request) {
    return this.hours.find({ where: { salonId: req.salonId }, order: { weekday: 'ASC', openTime: 'ASC' } });
  }

  @Post('exceptions')
  async addException(@Req() req: Request, @Body() dto: CreateExceptionDto) {
    // "Both or neither" + startTime < endTime is cross-field, so class-validator's
    // per-property decorators (already checked each is HH:MM if present) can't express it --
    // same reasoning and shape as replaceHours's own inline openTime/closeTime check above.
    // The DB's own CHECK constraint (see the migration) is the last line of defense, but a
    // 400 here is what actually reaches the provider as a real Persian-actionable message
    // instead of a raw constraint-violation 500.
    if ((dto.startTime === undefined) !== (dto.endTime === undefined)) {
      throw new BadRequestException('startTime and endTime must be provided together, or not at all');
    }
    if (dto.startTime !== undefined && dto.endTime !== undefined && dto.startTime >= dto.endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }
    // Per-worker time off is whole-day only for v1 (see the 1754800000000 migration's own
    // comment) -- availability.service.ts's workerOffDates only ever records a DATE, with
    // no notion of a narrower interval, so a partial-hour row here would silently be treated
    // as a full day off instead of the hours actually given. Rejecting the combination here
    // is what keeps that a clean 400 instead of a quietly wrong availability result.
    if (dto.workerId && dto.startTime !== undefined) {
      throw new BadRequestException('Partial-hour exceptions are not supported for a specific worker yet');
    }
    if (dto.workerId) {
      const worker = await this.workers.findOneBy({ id: dto.workerId, salonId: req.salonId });
      if (!worker) throw new NotFoundException('Worker not found');
    }
    try {
      return await this.exceptions.save(
        this.exceptions.create({
          salonId: req.salonId,
          date: dto.date,
          isClosed: dto.isClosed ?? true,
          startTime: dto.startTime ?? null,
          endTime: dto.endTime ?? null,
          reason: dto.reason ?? null,
          workerId: dto.workerId ?? null,
        }),
      );
    } catch (err) {
      // One of the two partial unique indexes (whole-salon or per-worker, salon_id+date[+worker_id])
      // is the actual race-safety backstop -- a double-submit lands here as a clean 409
      // instead of a raw constraint-violation 500.
      if (isUniqueViolation(err)) throw new ConflictException('برای این تاریخ قبلا یک تعطیلی ثبت شده است');
      throw err;
    }
  }

  @Get('exceptions')
  async listExceptions(@Req() req: Request, @Query('workerId') workerId?: string) {
    return this.exceptions.find({
      where: workerId ? { salonId: req.salonId, workerId } : { salonId: req.salonId },
      order: { date: 'ASC' },
    });
  }

  @Delete('exceptions/:id')
  @HttpCode(204)
  async removeException(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.exceptions.delete({ id, salonId: req.salonId });
    if (!result.affected) throw new NotFoundException();
  }
}

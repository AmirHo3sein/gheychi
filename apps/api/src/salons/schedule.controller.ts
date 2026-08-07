import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource, Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { CreateExceptionDto, ReplaceHoursDto } from './dto/schedule.dto';
import { findOverlappingHourRanges } from './schedule-hours.util';
import { SalonOwnerGuard } from './salon-owner.guard';
import { ScheduleException } from './schedule-exception.entity';
import { WorkingHour } from './working-hour.entity';

@Controller('salons/mine')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class ScheduleController {
  constructor(
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(ScheduleException) private readonly exceptions: Repository<ScheduleException>,
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
    return this.exceptions.save(
      this.exceptions.create({ salonId: req.salonId, date: dto.date, isClosed: dto.isClosed ?? true }),
    );
  }

  @Get('exceptions')
  async listExceptions(@Req() req: Request) {
    return this.exceptions.find({ where: { salonId: req.salonId }, order: { date: 'ASC' } });
  }

  @Delete('exceptions/:id')
  @HttpCode(204)
  async removeException(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.exceptions.delete({ id, salonId: req.salonId });
    if (!result.affected) throw new NotFoundException();
  }
}

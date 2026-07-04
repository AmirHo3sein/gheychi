import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource, Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateExceptionDto, ReplaceHoursDto } from './dto/schedule.dto';
import { SalonsService } from './salons.service';
import { ScheduleException } from './schedule-exception.entity';
import { WorkingHour } from './working-hour.entity';

@Controller('salons/mine')
@UseGuards(AuthGuard)
export class ScheduleController {
  constructor(
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(ScheduleException) private readonly exceptions: Repository<ScheduleException>,
    private readonly salons: SalonsService,
    private readonly dataSource: DataSource,
  ) {}

  private async mySalonId(req: Request): Promise<string> {
    return (await this.salons.findMine((req.user as User).id)).id;
  }

  @Put('hours')
  async replaceHours(@Req() req: Request, @Body() dto: ReplaceHoursDto) {
    for (const h of dto.hours) {
      if (h.openTime >= h.closeTime) {
        throw new BadRequestException(`openTime must be before closeTime (weekday ${h.weekday})`);
      }
    }
    const salonId = await this.mySalonId(req);
    return this.dataSource.transaction(async (em) => {
      await em.delete(WorkingHour, { salonId });
      return em.save(WorkingHour, dto.hours.map((h) => ({ ...h, salonId })));
    });
  }

  @Get('hours')
  async listHours(@Req() req: Request) {
    const salonId = await this.mySalonId(req);
    return this.hours.find({ where: { salonId }, order: { weekday: 'ASC', openTime: 'ASC' } });
  }

  @Post('exceptions')
  async addException(@Req() req: Request, @Body() dto: CreateExceptionDto) {
    const salonId = await this.mySalonId(req);
    return this.exceptions.save(
      this.exceptions.create({ salonId, date: dto.date, isClosed: dto.isClosed ?? true }),
    );
  }

  @Get('exceptions')
  async listExceptions(@Req() req: Request) {
    const salonId = await this.mySalonId(req);
    return this.exceptions.find({ where: { salonId }, order: { date: 'ASC' } });
  }

  @Delete('exceptions/:id')
  @HttpCode(204)
  async removeException(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const salonId = await this.mySalonId(req);
    const result = await this.exceptions.delete({ id, salonId });
    if (!result.affected) throw new NotFoundException();
  }
}

import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch,
  Post, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { ReferralsService } from '../referrals/referrals.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { CreateWorkerDto, UpdateWorkerDto } from './dto/worker.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { Worker } from './worker.entity';

@Controller('salons/mine/workers')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonWorkersController {
  constructor(
    @InjectRepository(Worker) private readonly workers: Repository<Worker>,
    private readonly usersService: UsersService,
    private readonly referralsService: ReferralsService,
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateWorkerDto) {
    const { user } = await this.usersService.findOrCreateByPhone(dto.phone);
    if (user.id === (req.user as User).id) {
      throw new BadRequestException('یک صاحب سالن نمی‌تواند کارمند خودش باشد');
    }

    try {
      return await this.workers.save(
        this.workers.create({ salonId: req.salonId, userId: user.id, name: dto.name }),
      );
    } catch (err) {
      // workers_salon_user_uidx UNIQUE(salon_id, user_id) is the actual race-safety
      // backstop here -- this user may already be on the roster.
      if (isUniqueViolation(err)) throw new ConflictException('این کاربر از قبل عضو تیم است');
      throw err;
    }
  }

  @Get()
  async list(@Req() req: Request) {
    return this.workers.find({ where: { salonId: req.salonId }, order: { createdAt: 'DESC' } });
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkerDto) {
    const worker = await this.workers.findOneBy({ id, salonId: req.salonId });
    if (!worker) throw new NotFoundException();
    Object.assign(worker, dto);
    return this.workers.save(worker);
  }

  // Lets the owner relay a worker's (lifetime, personal) referral code to them out of
  // band, in case the worker hasn't logged in yet to see it themselves.
  @Get(':id/referral-code')
  async referralCode(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const worker = await this.workers.findOneBy({ id, salonId: req.salonId });
    if (!worker) throw new NotFoundException();
    return this.referralsService.getOrCreateMyCode(worker.userId);
  }
}

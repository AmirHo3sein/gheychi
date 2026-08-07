import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch,
  Post, Req, UseGuards,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource, In, Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { ReferralsService } from '../referrals/referrals.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { CreateWorkerDto, UpdateWorkerDto, UpdateWorkerServicesDto } from './dto/worker.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonService } from './salon-service.entity';
import { Worker } from './worker.entity';
import { WorkerService } from './worker-service.entity';

@Controller('salons/mine/workers')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonWorkersController {
  constructor(
    @InjectRepository(Worker) private readonly workers: Repository<Worker>,
    @InjectRepository(WorkerService) private readonly workerServices: Repository<WorkerService>,
    @InjectRepository(SalonService) private readonly salonServices: Repository<SalonService>,
    @InjectDataSource() private readonly dataSource: DataSource,
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
      const worker = await this.workers.save(
        this.workers.create({ salonId: req.salonId, userId: user.id, name: dto.name }),
      );
      return { ...worker, serviceIds: [] };
    } catch (err) {
      // workers_salon_user_uidx UNIQUE(salon_id, user_id) is the actual race-safety
      // backstop here -- this user may already be on the roster.
      if (isUniqueViolation(err)) throw new ConflictException('این کاربر از قبل عضو تیم است');
      throw err;
    }
  }

  @Get()
  async list(@Req() req: Request) {
    const workers = await this.workers.find({ where: { salonId: req.salonId }, order: { createdAt: 'DESC' } });
    return this.attachServiceIds(workers);
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkerDto) {
    const worker = await this.workers.findOneBy({ id, salonId: req.salonId });
    if (!worker) throw new NotFoundException();
    Object.assign(worker, dto);
    const saved = await this.workers.save(worker);
    const [withServices] = await this.attachServiceIds([saved]);
    return withServices;
  }

  // Empty serviceIds is a valid, meaningful body -- it clears the worker back to
  // "unrestricted", not an error. Delete-all-then-reinsert, matching this codebase's
  // small-owned-collection convention (see SalonsService.updateMine's categoryIds handling).
  @Patch(':id/services')
  async updateServices(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkerServicesDto,
  ) {
    const worker = await this.workers.findOneBy({ id, salonId: req.salonId });
    if (!worker) throw new NotFoundException();

    if (dto.serviceIds.length > 0) {
      const found = await this.salonServices.count({ where: { id: In(dto.serviceIds), salonId: req.salonId } });
      if (found !== dto.serviceIds.length) {
        throw new BadRequestException('یک یا چند خدمت انتخاب‌شده معتبر نیست');
      }
    }

    await this.dataSource.transaction(async (em) => {
      await em.delete(WorkerService, { workerId: id });
      if (dto.serviceIds.length > 0) {
        await em.insert(WorkerService, dto.serviceIds.map((serviceId) => ({ workerId: id, serviceId })));
      }
    });

    return { id: worker.id, serviceIds: dto.serviceIds };
  }

  // Lets the owner relay a worker's (lifetime, personal) referral code to them out of
  // band, in case the worker hasn't logged in yet to see it themselves.
  @Get(':id/referral-code')
  async referralCode(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const worker = await this.workers.findOneBy({ id, salonId: req.salonId });
    if (!worker) throw new NotFoundException();
    return this.referralsService.getOrCreateMyCode(worker.userId);
  }

  // Manual join, not an ORM relation -- matches this codebase's existing repo convention
  // (see SalonsService.attachCategories). Batches all workers in one query.
  private async attachServiceIds<T extends { id: string }>(
    workers: T[],
  ): Promise<Array<T & { serviceIds: string[] }>> {
    if (workers.length === 0) return [];
    const workerIds = workers.map((w) => w.id);
    const rows = await this.workerServices.find({ where: { workerId: In(workerIds) } });
    const serviceIdsByWorker = new Map<string, string[]>();
    for (const row of rows) {
      const list = serviceIdsByWorker.get(row.workerId) ?? [];
      list.push(row.serviceId);
      serviceIdsByWorker.set(row.workerId, list);
    }
    return workers.map((w) => ({ ...w, serviceIds: serviceIdsByWorker.get(w.id) ?? [] }));
  }
}

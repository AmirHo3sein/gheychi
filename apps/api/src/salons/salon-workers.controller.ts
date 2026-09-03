import {
  BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe,
  Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource, In, Repository } from 'typeorm';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { ReferralsService } from '../referrals/referrals.service';
import { SalonSmsQuotaService } from '../sms/salon-sms-quota.service';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { CreateWorkerDto, UpdateWorkerDto, UpdateWorkerServicesDto } from './dto/worker.dto';
import { Salon } from './salon.entity';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonService } from './salon-service.entity';
import { Worker } from './worker.entity';
import { WorkerService } from './worker-service.entity';

@Controller('salons/mine/workers')
@UseGuards(SalonOwnerGuard)
export class SalonWorkersController {
  constructor(
    @InjectRepository(Worker) private readonly workers: Repository<Worker>,
    @InjectRepository(WorkerService) private readonly workerServices: Repository<WorkerService>,
    @InjectRepository(SalonService) private readonly salonServices: Repository<SalonService>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly referralsService: ReferralsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly config: ConfigService,
    private readonly smsQuota: SalonSmsQuotaService,
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateWorkerDto) {
    const { user } = await this.usersService.findOrCreateByPhone(dto.phone);
    if (user.id === (req.user as User).id) {
      throw new BadRequestException('یک صاحب سالن نمی‌تواند کارمند خودش باشد');
    }

    let worker: Worker;
    try {
      worker = await this.workers.save(
        this.workers.create({ salonId: req.salonId, userId: user.id, name: dto.name }),
      );
    } catch (err) {
      // workers_salon_user_uidx UNIQUE(salon_id, user_id) is the actual race-safety
      // backstop here -- this user may already be on the roster.
      if (isUniqueViolation(err)) throw new ConflictException('این کاربر از قبل عضو تیم است');
      throw err;
    }

    // Real "invitation" -- the one previously-missing piece: the worker themselves never
    // learned they'd been added, whether their account was brand-new (findOrCreateByPhone
    // above) or already existed. No accept/decline step or pending state -- the roster row
    // is already live the moment this succeeds (matches this codebase's existing worker
    // model, e.g. the referral-code relay endpoint below assumes the same "already a real
    // member, just hasn't logged in yet" shape) -- this SMS is purely so they find out.
    // Best-effort and fire-and-forget, same posture as every other notification send in
    // this codebase (PaymentsService.notifyOne): a down SMS provider must never fail the
    // owner's own request.
    void this.notifyWorkerAdded(user.phone, user.id, req.salonId!, (req.user as User).id).catch(() => {});

    return { ...worker, serviceIds: [] };
  }

  private async notifyWorkerAdded(phone: string, recipientUserId: string, salonId: string, actorId: string): Promise<void> {
    const salon = await this.salons.findOneBy({ id: salonId });
    // Approved salons only. Any self-registered user can create a (pending) salon with an
    // arbitrary 150-char name and then add "workers" by phone -- with no approval gate this
    // endpoint was an unauthenticated-in-practice channel for sending attacker-worded SMS
    // to any number at the platform's cost, bypassing the per-salon SMS quota entirely.
    // Once admin-approved the salon is a vetted, attributable actor; the roster row itself
    // is still created either way, only the invite text waits for approval.
    if (!salon || salon.status !== 'approved') return;
    const frontendBase = this.config.get('FRONTEND_BASE_URL', 'http://localhost:3003');
    const message = `شما توسط سالن «${salon.name}» به عنوان کارمند اضافه شدید. برای ورود همین شماره را وارد کنید: ${frontendBase}/login`;
    // Metered against the salon's own monthly SMS quota, like every other salon-triggered
    // message. Unmetered, this endpoint was an unlimited platform-paid SMS channel to any
    // phone: the roster row is unique per (salon, user), but add/remove/re-add is not, and
    // the number of distinct phones a salon can name is not bounded at all.
    // tryConsume, not consumeOrThrow: the worker IS on the roster either way, so running
    // out of budget must skip the invite rather than undo a successful add.
    await this.smsQuota.tryConsume(salonId, () => this.sms.send(phone, message), {
      customerId: recipientUserId,
      phone,
      message,
      sentBy: actorId,
    });
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

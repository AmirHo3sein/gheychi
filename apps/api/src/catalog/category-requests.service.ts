import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, ILike, Repository } from 'typeorm';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { REDIS } from '../redis/redis.module';
import { Salon } from '../salons/salon.entity';
import { User } from '../users/user.entity';
import { CategoryRequest, CategoryRequestStatus } from './category-request.entity';
import { CATEGORIES_CACHE_KEY } from './categories-cache.util';
import { AdminCategoryRequestQueryDto, ApproveCategoryRequestDto, CreateCategoryRequestDto, RejectCategoryRequestDto } from './dto/category-request.dto';
import { ServiceCategory } from './service-category.entity';

// listForAdmin's raw shape: same "no relation decorators, explicit joined columns"
// idiom as ReportsService.AdminReportListItem -- the admin queue needs to know WHICH
// salon/provider asked, not just the bare request row.
export interface AdminCategoryRequestListItem {
  id: string;
  requesterId: string;
  salonId: string;
  name: string;
  note: string | null;
  status: CategoryRequestStatus;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  categoryId: number | null;
  createdAt: Date;
  salonName: string;
  requesterPhone: string;
}

@Injectable()
export class CategoryRequestsService {
  constructor(
    @InjectRepository(CategoryRequest) private readonly requests: Repository<CategoryRequest>,
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    private readonly dataSource: DataSource,
    private readonly notifications: AdminNotificationsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async createForSalon(userId: string, salonId: string, dto: CreateCategoryRequestDto): Promise<CategoryRequest> {
    const trimmedName = dto.name.trim();
    // A category with this name (case-insensitive) already exists -- the real fix is
    // picking it from the existing list, not filing a request that would just 409 again
    // at approval time.
    const existing = await this.categories.findOneBy({ name: ILike(trimmedName) });
    if (existing) {
      throw new ConflictException('دسته‌بندی‌ای با این نام از قبل وجود دارد؛ می‌توانید همان را از لیست انتخاب کنید');
    }

    let created: CategoryRequest;
    try {
      created = await this.requests.save(
        this.requests.create({ requesterId: userId, salonId, name: trimmedName, note: dto.note?.trim() || null }),
      );
    } catch (err) {
      // category_requests_salon_name_pending_uidx -- this exact salon already has a
      // pending request for this exact name (case-insensitive).
      if (isUniqueViolation(err)) {
        throw new ConflictException('شما قبلاً برای این نام درخواست داده‌اید و در انتظار بررسی است');
      }
      throw err;
    }

    // Best-effort, matching salon_resubmitted's own fire-and-forget precedent (not the
    // report-creation transaction's stricter contract) -- a notification failure must
    // never fail the request submission itself.
    const salon = await this.salons.findOneBy({ id: salonId });
    this.notifications
      .emit(
        'category_requested',
        'درخواست دسته‌بندی جدید',
        `${salon?.name ?? 'یک سالن'}: «${trimmedName}»`,
        '/category-requests',
      )
      .catch(() => {});

    return created;
  }

  listForSalon(salonId: string): Promise<CategoryRequest[]> {
    return this.requests.find({ where: { salonId }, order: { createdAt: 'DESC' } });
  }

  async listForAdmin(
    query: AdminCategoryRequestQueryDto,
  ): Promise<{ items: AdminCategoryRequestListItem[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const status = query.status ?? 'pending';

    const qb = this.requests
      .createQueryBuilder('request')
      .leftJoin(Salon, 'salon', 'salon.id = request.salonId')
      .leftJoin(User, 'requester', 'requester.id = request.requesterId')
      .select('request.id', 'id')
      .addSelect('request.requesterId', 'requesterId')
      .addSelect('request.salonId', 'salonId')
      .addSelect('request.name', 'name')
      .addSelect('request.note', 'note')
      .addSelect('request.status', 'status')
      .addSelect('request.resolutionNote', 'resolutionNote')
      .addSelect('request.resolvedBy', 'resolvedBy')
      .addSelect('request.resolvedAt', 'resolvedAt')
      .addSelect('request.categoryId', 'categoryId')
      .addSelect('request.createdAt', 'createdAt')
      .addSelect('salon.name', 'salonName')
      .addSelect('requester.phone', 'requesterPhone')
      .orderBy('request.createdAt', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize);

    if (status !== 'all') qb.andWhere('request.status = :status', { status });

    const [items, total] = await Promise.all([
      qb.getRawMany<AdminCategoryRequestListItem>(),
      this.requests.count({ where: status === 'all' ? {} : { status } }),
    ]);
    return { items, total, page, pageSize };
  }

  async approve(adminId: string, id: string, dto: ApproveCategoryRequestDto): Promise<CategoryRequest> {
    const request = await this.requests.findOneBy({ id });
    if (!request) throw new NotFoundException('درخواست یافت نشد');
    if (request.status !== 'pending') throw new ConflictException('این درخواست قبلاً بررسی شده است');

    const result = await this.dataSource.transaction(async (em) => {
      let category: ServiceCategory;
      try {
        category = await em.save(ServiceCategory, em.create(ServiceCategory, { name: dto.name, icon: dto.icon }));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException('دسته‌بندی‌ای با این نام از قبل وجود دارد');
        }
        throw err;
      }

      // Conditional on status='pending' -- same lost-race guard as ReportsService.resolve:
      // a concurrent admin who already resolved this request means 0 rows affected here,
      // and the whole transaction (including the category just created above) rolls back
      // rather than leaving an orphaned duplicate category behind.
      const update = await em.update(
        CategoryRequest,
        { id, status: 'pending' },
        { status: 'approved', categoryId: category.id, resolvedBy: adminId, resolvedAt: new Date() },
      );
      if (!update.affected) throw new ConflictException('این درخواست قبلاً بررسی شده است');

      return (await em.findOneBy(CategoryRequest, { id }))!;
    });

    await this.redis.del(CATEGORIES_CACHE_KEY);
    return result;
  }

  async reject(adminId: string, id: string, dto: RejectCategoryRequestDto): Promise<CategoryRequest> {
    const existing = await this.requests.findOneBy({ id });
    if (!existing) throw new NotFoundException('درخواست یافت نشد');

    const result = await this.requests.update(
      { id, status: 'pending' },
      { status: 'rejected', resolutionNote: dto.note, resolvedBy: adminId, resolvedAt: new Date() },
    );
    if (!result.affected) throw new ConflictException('این درخواست قبلاً بررسی شده است');
    return (await this.requests.findOneBy({ id }))!;
  }
}

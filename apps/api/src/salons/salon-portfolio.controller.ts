import { randomUUID } from 'crypto';
import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Logger,
  NotFoundException, Param, ParseFilePipeBuilder, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
import { CreatePortfolioItemDto, UpdatePortfolioItemDto } from './dto/portfolio-item.dto';
import { PortfolioItem } from './portfolio-item.entity';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonService } from './salon-service.entity';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PORTFOLIO_CAP = 40;

@Controller('salons/mine/portfolio')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonPortfolioController {
  private readonly logger = new Logger(SalonPortfolioController.name);

  constructor(
    @InjectRepository(PortfolioItem) private readonly items: Repository<PortfolioItem>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  @Get()
  list(@Req() req: Request) {
    // All rows including 'removed' ones, so the owner sees the removed-by-admin badge.
    return this.items.find({
      where: { salonId: req.salonId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipeBuilder()
        // Real magic-number content-sniffing (via the `file-type` package), with no
        // mimetype-trusting fallback. The client-declared Content-Type header is never
        // trusted on its own; only actual file bytes matching a real image signature pass.
        .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
    @Body() dto: CreatePortfolioItemDto,
  ) {
    const salonId = req.salonId!;
    const count = await this.items.count({ where: { salonId } });
    if (count >= PORTFOLIO_CAP) {
      throw new ConflictException('حداکثر ۴۰ نمونه کار مجاز است');
    }
    await this.requireOwnService(salonId, dto.serviceId);
    // Append at MAX(sort_order)+1, NOT at the row count: deletes never resequence, so
    // after delete-then-upload the count can equal an existing row's sort_order — a
    // duplicate that turns the provider panel's swap-based reorder into a permanent
    // no-op for the tied pair (swapping 2 and 2 changes nothing).
    const maxSortOrder = await this.items.maximum('sortOrder', { salonId });
    // Deliberately NOT using file.originalname in the key -- it's client-controlled and
    // could contain path-traversal sequences (e.g. `../../etc/x`). The mimetype was already
    // restricted to image/jpeg|png|webp by the validator above, so deriving the extension
    // from it (rather than from the client's filename) keeps the key fully server-controlled.
    const extension = EXTENSION_BY_MIME_TYPE[file.mimetype] ?? 'bin';
    const key = `salons/${salonId}/portfolio/${randomUUID()}.${extension}`;
    const url = await this.storage.upload(file.buffer, key, file.mimetype);
    return this.items.save(
      this.items.create({
        salonId,
        url,
        storageKey: key,
        caption: dto.caption ?? null,
        serviceId: dto.serviceId ?? null,
        sortOrder: (maxSortOrder ?? -1) + 1,
      }),
    );
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePortfolioItemDto) {
    const salonId = req.salonId!;
    const item = await this.items.findOneBy({ id, salonId });
    if (!item) throw new NotFoundException();
    if (dto.serviceId) await this.requireOwnService(salonId, dto.serviceId);
    // The validation pipe defines EVERY dto field as an own property (undefined when
    // omitted), so a bare Object.assign would smear undefineds over the loaded entity
    // and make the response misreport untouched columns as cleared (same hazard
    // documented in SalonsService.updateMine). Explicit null (serviceId) still lands.
    Object.assign(item, Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)));
    return this.items.save(item);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const salonId = req.salonId!;
    const item = await this.items.findOneBy({ id, salonId });
    if (!item) throw new NotFoundException();
    await this.items.delete({ id, salonId });
    // Best-effort: the DB row is the source of truth for what's shown; an orphaned
    // object left in storage after a delete failure is a cleanup gap, not a
    // user-visible bug -- so the failure is logged for observability but never
    // fails the request (same policy as salon photo deletes).
    await this.storage.delete(item.storageKey).catch((err) => {
      this.logger.error(
        `Failed to delete storage object ${item.storageKey} for portfolio item ${item.id} (salon ${salonId}) -- object may be orphaned`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  private async requireOwnService(salonId: string, serviceId: string | null | undefined): Promise<void> {
    if (!serviceId) return;
    const service = await this.services.findOneBy({ id: serviceId, salonId });
    if (!service) throw new BadRequestException('سرویس انتخاب‌شده متعلق به این سالن نیست');
  }
}

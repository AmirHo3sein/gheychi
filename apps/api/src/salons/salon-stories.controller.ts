import { randomUUID } from 'crypto';
import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Logger,
  NotFoundException, Param, ParseFilePipeBuilder, ParseUUIDPipe, Post, Req, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
import { CreateStoryDto } from './dto/salon-story.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonService } from './salon-service.entity';
import { SalonStory } from './salon-story.entity';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// A slot is occupied by any unexpired story regardless of status: a 'removed' story
// keeps its slot until natural expiry, which closes the upload-remove-upload churn
// a status-filtered count would allow.
const ACTIVE_STORY_CAP = 10;

@Controller('salons/mine/stories')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonStoriesController {
  private readonly logger = new Logger(SalonStoriesController.name);

  constructor(
    @InjectRepository(SalonStory) private readonly stories: Repository<SalonStory>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  @Get()
  list(@Req() req: Request) {
    // All unexpired rows including 'removed' ones, so the owner sees the
    // removed-by-admin badge. Expiry is a DB-clock predicate, never app time.
    return this.stories
      .createQueryBuilder('story')
      .where('story.salon_id = :salonId', { salonId: req.salonId })
      .andWhere('story.expires_at > now()')
      .orderBy('story.created_at', 'ASC')
      .getMany();
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
    @Body() dto: CreateStoryDto,
  ) {
    const salonId = req.salonId!;
    const active = await this.stories
      .createQueryBuilder('story')
      .where('story.salon_id = :salonId', { salonId })
      .andWhere('story.expires_at > now()')
      .getCount();
    if (active >= ACTIVE_STORY_CAP) {
      throw new ConflictException('حداکثر ۱۰ استوری فعال مجاز است');
    }
    if (dto.serviceId) {
      const service = await this.services.findOneBy({ id: dto.serviceId, salonId });
      if (!service) throw new BadRequestException('سرویس انتخاب‌شده متعلق به این سالن نیست');
    }
    // Deliberately NOT using file.originalname in the key -- it's client-controlled and
    // could contain path-traversal sequences (e.g. `../../etc/x`). The mimetype was already
    // restricted to image/jpeg|png|webp by the validator above, so deriving the extension
    // from it (rather than from the client's filename) keeps the key fully server-controlled.
    const extension = EXTENSION_BY_MIME_TYPE[file.mimetype] ?? 'bin';
    const key = `salons/${salonId}/stories/${randomUUID()}.${extension}`;
    const url = await this.storage.upload(file.buffer, key, file.mimetype);
    // expires_at is stamped by the DB clock -- the same clock every read filter and the
    // cap count above compare against -- so app-clock drift can never skew the TTL.
    const insert = await this.stories.insert({
      salonId,
      url,
      storageKey: key,
      caption: dto.caption ?? null,
      serviceId: dto.serviceId ?? null,
      expiresAt: () => `now() + interval '24 hours'`,
    });
    return this.stories.findOneByOrFail({ id: insert.identifiers[0].id as string });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const salonId = req.salonId!;
    const story = await this.stories.findOneBy({ id, salonId });
    if (!story) throw new NotFoundException();
    await this.stories.delete({ id, salonId });
    // Best-effort: the DB row is the source of truth for what's shown; an orphaned
    // object left in storage after a delete failure is a cleanup gap, not a
    // user-visible bug -- so the failure is logged for observability but never
    // fails the request (same policy as salon photo deletes).
    await this.storage.delete(story.storageKey).catch((err) => {
      this.logger.error(
        `Failed to delete storage object ${story.storageKey} for salon story ${story.id} (salon ${salonId}) -- object may be orphaned`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  }
}

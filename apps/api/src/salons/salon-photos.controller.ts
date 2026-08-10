import { randomUUID } from 'crypto';
import {
  Body, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Logger, NotFoundException, Param,
  ParseFilePipeBuilder, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource, Repository } from 'typeorm';
import {
  ALLOWED_IMAGE_MIME_TYPE_PATTERN, assertTrustedImageMimeType, EXTENSION_BY_IMAGE_MIME_TYPE,
} from '../common/trusted-image-upload';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
import { UpdateSalonPhotoDto } from './dto/salon-photo.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonPhoto } from './salon-photo.entity';

// Unlike PortfolioItem (PORTFOLIO_CAP) and SalonStory (ACTIVE_STORY_CAP + natural
// expiry), this list previously had no ceiling at all -- both of growth (unbounded
// uploads) and of the list query itself (no `take`). Adding the cap alone is enough:
// once uploads can never exceed it, list() is bounded by construction, matching how
// the two sibling controllers rely solely on their own upload cap too (neither adds a
// separate `take` to its own list query).
const PHOTO_CAP = 30;

@Controller('salons/mine/photos')
@UseGuards(SalonOwnerGuard)
export class SalonPhotosController {
  private readonly logger = new Logger(SalonPhotosController.name);

  constructor(
    @InjectRepository(SalonPhoto) private readonly photos: Repository<SalonPhoto>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  list(@Req() req: Request) {
    return this.photos.find({ where: { salonId: req.salonId }, order: { isCover: 'DESC', sortOrder: 'ASC' } });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipeBuilder()
        // Real magic-number content-sniffing (via the `file-type` package) -- rejects
        // anything whose actual bytes aren't a real image, regardless of what Content-Type
        // the client declared. Does NOT by itself make file.mimetype trustworthy (see
        // assertTrustedImageMimeType below) -- it validates the file's real content, not
        // the separate, still-client-controlled file.mimetype field.
        .addFileTypeValidator({ fileType: ALLOWED_IMAGE_MIME_TYPE_PATTERN })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    // file.mimetype is the client-declared Content-Type header, independent of the
    // magic-number check above -- must be checked separately before it's trusted for
    // the storage Content-Type below (S3StorageProvider persists it verbatim).
    assertTrustedImageMimeType(file.mimetype);
    const salonId = req.salonId!;
    const count = await this.photos.count({ where: { salonId } });
    if (count >= PHOTO_CAP) {
      throw new ConflictException('حداکثر ۳۰ عکس مجاز است');
    }
    // Deliberately NOT using file.originalname in the key -- it's client-controlled and
    // could contain path-traversal sequences (e.g. `../../etc/x`). file.mimetype is now
    // verified-trusted (above), so deriving the extension from it keeps the key fully
    // server-controlled.
    const extension = EXTENSION_BY_IMAGE_MIME_TYPE[file.mimetype] ?? 'bin';
    const key = `salons/${salonId}/${randomUUID()}.${extension}`;
    const url = await this.storage.upload(file.buffer, key, file.mimetype);
    return this.photos.save(
      this.photos.create({ salonId, url, storageKey: key, sortOrder: count, isCover: count === 0 }),
    );
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalonPhotoDto) {
    const salonId = req.salonId!;
    const photo = await this.photos.findOneBy({ id, salonId });
    if (!photo) throw new NotFoundException();
    Object.assign(photo, dto);

    if (dto.isCover === true) {
      // A salon may only have one cover photo -- unset it on the salon's other photos in
      // the same transaction as the save, so a concurrent read can never observe two rows
      // with is_cover = true.
      return this.dataSource.transaction(async (em) => {
        await em.update(SalonPhoto, { salonId }, { isCover: false });
        return em.save(SalonPhoto, photo);
      });
    }
    return this.photos.save(photo);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const salonId = req.salonId!;
    const photo = await this.photos.findOneBy({ id, salonId });
    if (!photo) throw new NotFoundException();
    await this.photos.delete({ id, salonId });
    // Best-effort: the DB row is the source of truth for what's shown in the gallery; an
    // orphaned object left in storage after a delete failure is a cleanup gap, not a
    // user-visible bug (same class of tradeoff as this codebase's SMS/push sends) -- so
    // the failure is logged for observability but never fails the request.
    // Skip pre-migration rows whose storage_key defaulted to '' -- deleting that would
    // resolve to the uploads root directory itself.
    if (photo.storageKey) {
      await this.storage.delete(photo.storageKey).catch((err) => {
        this.logger.error(
          `Failed to delete storage object ${photo.storageKey} for salon photo ${photo.id} (salon ${salonId}) -- object may be orphaned`,
          err instanceof Error ? err.stack : String(err),
        );
      });
    }
  }
}

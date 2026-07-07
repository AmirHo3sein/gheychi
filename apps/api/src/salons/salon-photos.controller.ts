import { randomUUID } from 'crypto';
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param,
  ParseFilePipeBuilder, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
import { UpdateSalonPhotoDto } from './dto/salon-photo.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonPhoto } from './salon-photo.entity';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Controller('salons/mine/photos')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonPhotosController {
  constructor(
    @InjectRepository(SalonPhoto) private readonly photos: Repository<SalonPhoto>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
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
        // Real magic-number content-sniffing (via the `file-type` package), with no
        // mimetype-trusting fallback. The client-declared Content-Type header is never
        // trusted on its own; only actual file bytes matching a real image signature pass.
        .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    const salonId = req.salonId!;
    const count = await this.photos.count({ where: { salonId } });
    // Deliberately NOT using file.originalname in the key -- it's client-controlled and
    // could contain path-traversal sequences (e.g. `../../etc/x`). The mimetype was already
    // restricted to image/jpeg|png|webp by the validator above, so deriving the extension
    // from it (rather than from the client's filename) keeps the key fully server-controlled.
    const extension = EXTENSION_BY_MIME_TYPE[file.mimetype] ?? 'bin';
    const key = `salons/${salonId}/${randomUUID()}.${extension}`;
    const url = await this.storage.upload(file.buffer, key, file.mimetype);
    return this.photos.save(
      this.photos.create({ salonId, url, storageKey: key, sortOrder: count, isCover: count === 0 }),
    );
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalonPhotoDto) {
    const photo = await this.photos.findOneBy({ id, salonId: req.salonId });
    if (!photo) throw new NotFoundException();
    Object.assign(photo, dto);
    return this.photos.save(photo);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const photo = await this.photos.findOneBy({ id, salonId: req.salonId });
    if (!photo) throw new NotFoundException();
    await this.photos.delete({ id });
    // Best-effort: the DB row is the source of truth for what's shown in the gallery; an
    // orphaned object left in storage after a delete failure is a harmless cleanup gap,
    // not a user-visible bug (same class of tradeoff as this codebase's SMS/push sends).
    await this.storage.delete(photo.storageKey).catch(() => {});
  }
}

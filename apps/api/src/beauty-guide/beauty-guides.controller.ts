import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseFilePipeBuilder, ParseUUIDPipe, Patch, Post, Query,
  Req, Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { ALLOWED_IMAGE_MIME_TYPE_PATTERN, assertTrustedImageMimeType } from '../common/trusted-image-upload';
import { User } from '../users/user.entity';
import { BeautyGuidesService } from './beauty-guides.service';
import { BeautyGuideMatchesQueryDto, UpdateBeautyGuideDto } from './dto/beauty-guide.dto';
import { MAX_INSPIRATION_UPLOAD_BYTES } from './image-processing';

/**
 * Customer-facing Beauty Guide routes. Every route is authenticated (global AuthGuard, no
 * @Public()) and scoped to the caller's own guides -- another user's guide id is a 404.
 * The whole surface 404s while `feature_beauty_guide_enabled` is off.
 */
@Controller('beauty-guides')
export class BeautyGuidesController {
  constructor(private readonly guides: BeautyGuidesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_INSPIRATION_UPLOAD_BYTES } }))
  create(
    @Req() req: Request,
    @UploadedFile(
      // Same two-step validation as every other upload in the app: real-byte sniffing,
      // then the separately client-controlled declared mimetype (see trusted-image-upload).
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: ALLOWED_IMAGE_MIME_TYPE_PATTERN })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    assertTrustedImageMimeType(file.mimetype);
    return this.guides.createFromUpload((req.user as User).id, file.buffer);
  }

  @Post('from-portfolio/:portfolioItemId')
  createFromPortfolio(@Req() req: Request, @Param('portfolioItemId', ParseUUIDPipe) portfolioItemId: string) {
    return this.guides.createFromPortfolio((req.user as User).id, portfolioItemId);
  }

  // Declared before ':id' so it isn't captured by the id route. The active vocabulary, for
  // the customer's "not this — I meant…" correction picker.
  @Get('concepts')
  concepts() {
    return this.guides.listActiveConcepts();
  }

  @Get()
  list(@Req() req: Request) {
    return this.guides.list((req.user as User).id);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.guides.get((req.user as User).id, id);
  }

  @Get(':id/image')
  async image(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const bytes = await this.guides.getImage((req.user as User).id, id);
    setPrivateImageHeaders(res);
    return new StreamableFile(bytes, { type: 'image/jpeg' });
  }

  @Get(':id/matches')
  matches(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Query() query: BeautyGuideMatchesQueryDto) {
    return this.guides.matches((req.user as User).id, id, query);
  }

  @Post(':id/retry')
  retry(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.guides.retry((req.user as User).id, id);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBeautyGuideDto) {
    return this.guides.update((req.user as User).id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.guides.remove((req.user as User).id, id);
  }
}

/** Private, per-user bytes: never cached by shared caches, never content-sniffed. */
export function setPrivateImageHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
}

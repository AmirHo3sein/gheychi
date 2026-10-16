import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseFilePipeBuilder, ParseUUIDPipe,
  Patch, Post, Req, UnprocessableEntityException, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { ALLOWED_IMAGE_MIME_TYPE_PATTERN, assertTrustedImageMimeType } from '../common/trusted-image-upload';
import { CreateServiceDto, UpdateServiceDto } from './dto/salon-service.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonService } from './salon-service.entity';
import { SalonServicesService } from './salon-services.service';
import { MAX_SERVICE_IMAGE_UPLOAD_BYTES } from './service-image.util';

const uploadPipeMessage = (error: string): string =>
  /required/i.test(error) ? 'فایل تصویری ارسال نشده است' : 'فقط تصاویر JPEG، PNG یا WebP پذیرفته می‌شوند';

@Controller('salons/mine/services')
@UseGuards(SalonOwnerGuard)
export class SalonServicesController {
  constructor(
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    private readonly salonServicesService: SalonServicesService,
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateServiceDto) {
    return this.salonServicesService.create(req.salonId!, dto);
  }

  @Get()
  async list(@Req() req: Request) {
    return this.services.find({ where: { salonId: req.salonId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto) {
    return this.salonServicesService.update(req.salonId!, id, dto);
  }

  // Same validation chain as salon-portfolio.controller.ts (magic-number sniff, then the
  // trusted-mimetype guard); the service additionally re-encodes to JPEG, so the stored
  // Content-Type never comes from the client at all. Archiving a service (DELETE :id below)
  // also clears and deletes its image -- see SalonServicesService.archive().
  @Post(':id/image')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SERVICE_IMAGE_UPLOAD_BYTES } }))
  async uploadImage(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: ALLOWED_IMAGE_MIME_TYPE_PATTERN })
        // The pipe's own messages are English validator internals ("Validation failed
        // (current file type is …)") that the provider panel would show verbatim.
        .build({ exceptionFactory: (error) => new UnprocessableEntityException(uploadPipeMessage(error)) }),
    )
    file: Express.Multer.File,
  ) {
    assertTrustedImageMimeType(file.mimetype);
    return this.salonServicesService.setImage(req.salonId!, id, file.buffer);
  }

  @Delete(':id/image')
  async removeImage(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.salonServicesService.removeImage(req.salonId!, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.salonServicesService.archive(req.salonId!, id);
  }
}

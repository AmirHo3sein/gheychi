import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CreatePackageDto, UpdatePackageDto } from './dto/salon-package.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonPackagesService } from './salon-packages.service';

@Controller('salons/mine/packages')
@UseGuards(SalonOwnerGuard)
export class SalonPackagesController {
  constructor(private readonly packages: SalonPackagesService) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreatePackageDto) {
    return this.packages.create(req.salonId!, dto);
  }

  @Get()
  async list(@Req() req: Request) {
    const packages = await this.packages.list(req.salonId!);
    return Promise.all(
      packages.map(async (pkg) => ({ ...pkg, items: await this.packages.itemsFor(pkg.id) })),
    );
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePackageDto) {
    return this.packages.update(req.salonId!, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.packages.archive(req.salonId!, id);
  }
}

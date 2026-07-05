import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Salon } from './salon.entity';
import { SalonService } from './salon-service.entity';
import { SalonPhoto } from './salon-photo.entity';
import { WorkingHour } from './working-hour.entity';

@Controller('salons/:slug')
export class PublicSalonContentController {
  constructor(
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(SalonPhoto) private readonly photos: Repository<SalonPhoto>,
  ) {}

  private async requireSalonId(slug: string): Promise<string> {
    const salon = await this.salons.findOneBy({ slug, status: 'approved' });
    if (!salon) throw new NotFoundException('Salon not found');
    return salon.id;
  }

  @Get('services')
  async listServices(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    return this.services.find({ where: { salonId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  @Get('hours')
  async listHours(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    return this.hours.find({ where: { salonId }, order: { weekday: 'ASC', openTime: 'ASC' } });
  }

  @Get('photos')
  async listPhotos(@Param('slug') slug: string) {
    const salonId = await this.requireSalonId(slug);
    return this.photos.find({ where: { salonId }, order: { isCover: 'DESC', sortOrder: 'ASC' } });
  }
}

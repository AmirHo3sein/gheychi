import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { CreateSalonDto, UpdateSalonDto } from './dto/salon.dto';
import { Salon } from './salon.entity';
import { makeSlug } from './slug.util';

@Injectable()
export class SalonsService {
  constructor(
    @InjectRepository(Salon) private readonly repo: Repository<Salon>,
    private readonly users: UsersService,
  ) {}

  async createForOwner(ownerId: string, dto: CreateSalonDto): Promise<Salon> {
    const existing = await this.repo.findOneBy({ ownerId });
    if (existing) throw new ConflictException('You already have a salon');

    const salon = await this.repo.save(
      this.repo.create({
        ownerId,
        name: dto.name,
        slug: makeSlug(dto.name),
        description: dto.description ?? null,
        genderTarget: dto.genderTarget,
        address: dto.address,
        city: dto.city,
        capacity: dto.capacity ?? 1,
        location: { type: 'Point', coordinates: [dto.lng, dto.lat] },
      }),
    );
    await this.users.promoteToProvider(ownerId);
    return salon;
  }

  async findMine(ownerId: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ ownerId });
    if (!salon) throw new NotFoundException('No salon for this account');
    return salon;
  }

  async updateMine(ownerId: string, dto: UpdateSalonDto): Promise<Salon> {
    const salon = await this.findMine(ownerId);
    const { lat, lng, ...rest } = dto;
    Object.assign(salon, rest);
    if (lat !== undefined && lng !== undefined) {
      salon.location = { type: 'Point', coordinates: [lng, lat] };
    }
    return this.repo.save(salon);
  }

  async findPublicBySlug(slug: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ slug, status: 'approved' });
    if (!salon) throw new NotFoundException();
    return salon;
  }
}

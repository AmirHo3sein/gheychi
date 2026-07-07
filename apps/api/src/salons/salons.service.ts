import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

  async resubmitMine(ownerId: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ ownerId });
    if (!salon) throw new NotFoundException('Salon not found');
    if (salon.status !== 'rejected') {
      throw new BadRequestException('Only a rejected salon can be resubmitted');
    }
    // Guard against a concurrent admin action (approve or re-reject) on the same
    // salon landing between the read above and this write -- without conditioning
    // on the status still being 'rejected', an unconditional update({id}, ...) would
    // silently clobber whatever the admin just set, with no error to either caller.
    // Conditioning the update on the previously-read status (the same pattern used
    // by BookingsService's cancel()/updateStatus()) means only the winner's write
    // lands; a losing concurrent call gets a clear 409 instead of a misleading 200.
    const result = await this.repo.update(
      { id: salon.id, status: 'rejected' },
      { status: 'pending', rejectionReason: null },
    );
    if (!result.affected) {
      throw new ConflictException('Salon status changed before this resubmission could be applied');
    }
    return (await this.repo.findOneBy({ id: salon.id }))!;
  }

  async findPublicBySlug(slug: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ slug, status: 'approved' });
    if (!salon) throw new NotFoundException();
    return salon;
  }

  findById(id: string): Promise<Salon | null> {
    return this.repo.findOneBy({ id });
  }
}

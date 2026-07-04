import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Gender, User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  async findOrCreateByPhone(phone: string): Promise<{ user: User; isNew: boolean }> {
    const existing = await this.repo.findOneBy({ phone });
    if (existing) return { user: existing, isNew: false };
    const user = await this.repo.save(this.repo.create({ phone }));
    return { user, isNew: true };
  }

  async updateProfile(id: string, patch: { name?: string; gender?: Gender }): Promise<User> {
    await this.repo.update({ id }, patch);
    return (await this.repo.findOneBy({ id }))!;
  }

  async promoteToProvider(id: string): Promise<void> {
    await this.repo.update({ id, role: 'customer' }, { role: 'provider' });
  }
}

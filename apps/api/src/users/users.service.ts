import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Gender, User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  /**
   * `em` is passed by verify-otp's referral-code path (AuthController) so the new
   * user row and its referral redemption commit atomically in one transaction;
   * omitted by every other caller, which just uses the injected repository directly.
   */
  async findOrCreateByPhone(phone: string, em?: EntityManager): Promise<{ user: User; isNew: boolean }> {
    const repo = em ? em.getRepository(User) : this.repo;
    const existing = await repo.findOneBy({ phone });
    if (existing) return { user: existing, isNew: false };
    const user = await repo.save(repo.create({ phone }));
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

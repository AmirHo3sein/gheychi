import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Salon, SuspendedCause } from '../salons/salon.entity';
import { User, UserStatus } from './user.entity';

const OWNER_SUSPENDED: SuspendedCause = 'owner_suspended';

@Injectable()
export class AdminUsersService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Sets a user's status and cascades onto their owned salon in ONE transaction
   * (Plan 7 spec 3.5):
   *  - suspend:    salon WHERE owner_id AND status='approved'
   *                  -> status='suspended', suspended_cause='owner_suspended'
   *  - reactivate: salon WHERE owner_id AND status='suspended' AND suspended_cause='owner_suspended'
   *                  -> status='approved', suspended_cause=NULL
   * A salon an admin suspended directly (suspended_cause='admin') never matches the
   * reactivate WHERE clause, so it stays suspended -- that is the whole point of the cause column.
   */
  async setStatus(actingAdminId: string, targetUserId: string, status: UserStatus): Promise<User> {
    if (targetUserId === actingAdminId) {
      throw new BadRequestException('You cannot change your own account status');
    }

    return this.dataSource.transaction(async (em) => {
      const result = await em.update(User, { id: targetUserId }, { status });
      if (!result.affected) throw new NotFoundException();

      if (status === 'suspended') {
        await em.update(
          Salon,
          { ownerId: targetUserId, status: 'approved' },
          { status: 'suspended', suspendedCause: OWNER_SUSPENDED },
        );
      } else {
        await em.update(
          Salon,
          { ownerId: targetUserId, status: 'suspended', suspendedCause: OWNER_SUSPENDED },
          { status: 'approved', suspendedCause: null },
        );
      }

      return (await em.findOneBy(User, { id: targetUserId }))!;
    });
  }
}

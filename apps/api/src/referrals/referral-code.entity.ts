import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// One lifetime code per person (Product Decision 3) -- no owner_kind/owner_worker_id.
// Which reward tier a redemption resolves to is computed dynamically at redemption
// time (ReferralsService.resolveReferralType), never stored here.
@Entity('referral_codes')
export class ReferralCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  code: string;

  @Column({ name: 'owner_user_id', unique: true })
  ownerUserId: string;

  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  disabledAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

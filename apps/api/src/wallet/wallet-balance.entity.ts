import { Column, Entity, PrimaryColumn } from 'typeorm';

export type WalletCurrency = 'toman' | 'points';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

// Composite PK (user_id, currency) -- one row per (user, currency) pair, following
// this codebase's existing composite-PK convention (see favorites/favorite.entity.ts):
// plain @PrimaryColumn on both columns, no separate surrogate id.
@Entity('wallet_balances')
export class WalletBalance {
  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @PrimaryColumn({ type: 'varchar', length: 10, default: 'toman' })
  currency: WalletCurrency;

  @Column({ type: 'bigint', default: 0, transformer: bigintToNumber })
  balance: number;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

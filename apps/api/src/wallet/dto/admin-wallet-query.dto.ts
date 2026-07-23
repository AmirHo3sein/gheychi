import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { WalletTransactionType } from '../wallet-transaction.entity';

const WALLET_TRANSACTION_TYPES: WalletTransactionType[] = ['referral_reward', 'referral_reversal', 'admin_adjustment'];

/** GET /admin/wallet/transactions -- global ledger search, mirrors AuditLogQueryDto's
 * filter/paginate shape (actorId/action/targetType/from/to/page/pageSize). */
export class AdminWalletQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(WALLET_TRANSACTION_TYPES)
  type?: WalletTransactionType;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { WalletCurrency } from '../wallet-balance.entity';

/**
 * POST /admin/wallet/adjust. `reason` is @IsNotEmpty() -- unlike most admin DTOs
 * elsewhere in this codebase, since real money moves here with no underlying
 * business-event trigger (no booking, no coupon redemption, nothing else to point an
 * auditor at later besides this string). `amount === 0` is rejected in the controller
 * rather than here -- class-validator has no clean "not equal to zero" decorator, and
 * the 400 message reads better hand-written.
 *
 * Trimmed via @Transform before @IsNotEmpty runs: class-validator's IsNotEmpty only
 * rejects the literal empty string, so a whitespace-only reason (e.g. " ") would
 * otherwise pass validation and land in wallet_transactions.reason/the audit log as a
 * meaningless value -- this closes that gap and normalizes what's stored either way.
 */
export class AdjustWalletDto {
  @IsUUID()
  userId: string;

  // Signed: positive = credit, negative = debit.
  @Type(() => Number)
  @IsInt()
  amount: number;

  @IsOptional()
  @IsIn(['toman', 'points'])
  currency?: WalletCurrency;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  reason: string;
}

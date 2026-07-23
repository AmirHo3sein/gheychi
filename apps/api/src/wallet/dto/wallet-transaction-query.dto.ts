import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** GET /wallet/mine/transactions -- own rows only, page/pageSize mirror the codebase's
 * existing paginated customer-facing endpoints (e.g. AdminWorkerRatingQueryDto). */
export class WalletTransactionQueryDto {
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

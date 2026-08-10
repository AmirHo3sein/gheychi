import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminWalletQueryDto } from './dto/admin-wallet-query.dto';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { WalletService } from './wallet.service';

@Controller('admin/wallet')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminWalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('transactions')
  list(@Query() query: AdminWalletQueryDto) {
    return this.wallet.getTransactionsForAdmin(query);
  }

  /**
   * Unlike the future referral-reversal caller of WalletService.debit() (which
   * specifically wants the capped-with-shortfall behavior so a reversal transaction
   * never has to roll back), an admin manually correcting a mistake must get a clear
   * failure rather than a silent partial debit -- this endpoint requires the full
   * requested amount to move atomically or not at all. So a would-exceed-balance
   * debit is rejected with 400 here, checked against `shortfall` after calling
   * debit() inside the same transaction that gets rolled back on rejection.
   */
  @Post('adjust')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('wallet.adjust', 'wallet')
  async adjust(@Body() dto: AdjustWalletDto) {
    if (dto.amount === 0) throw new BadRequestException('Amount must not be zero');
    const currency = dto.currency ?? 'toman';

    return this.dataSource.transaction(async (em) => {
      if (dto.amount > 0) {
        const result = await this.wallet.credit(em, dto.userId, currency, dto.amount, 'admin_adjustment', {
          reason: dto.reason,
        });
        return { balanceAfter: result.balanceAfter };
      }

      const result = await this.wallet.debit(em, dto.userId, currency, -dto.amount, 'admin_adjustment', {
        reason: dto.reason,
      });
      if (result.shortfall > 0) {
        throw new BadRequestException('Insufficient wallet balance for this debit');
      }
      return { balanceAfter: result.balanceAfter };
    });
  }
}

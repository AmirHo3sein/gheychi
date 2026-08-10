import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../users/user.entity';
import { WalletTransactionQueryDto } from './dto/wallet-transaction-query.dto';
import { WalletService } from './wallet.service';

@Controller('wallet/mine')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  async getBalances(@Req() req: Request) {
    const balances = await this.wallet.getBalances((req.user as User).id);
    return { balances: balances.map((b) => ({ currency: b.currency, balance: b.balance })) };
  }

  @Get('transactions')
  getTransactions(@Req() req: Request, @Query() query: WalletTransactionQueryDto) {
    return this.wallet.getTransactions((req.user as User).id, query);
  }
}

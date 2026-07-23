import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminWalletController } from './admin-wallet.controller';
import { WalletBalance } from './wallet-balance.entity';
import { WalletTransaction } from './wallet-transaction.entity';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [TypeOrmModule.forFeature([WalletBalance, WalletTransaction]), AuthModule, AuditModule, UsersModule],
  controllers: [WalletController, AdminWalletController],
  providers: [WalletService],
  // Future referral slices (3-5) will import this module for WalletService, and
  // WalletBalance/WalletTransaction repositories via the re-exported TypeOrmModule.
  exports: [WalletService, TypeOrmModule],
})
export class WalletModule {}

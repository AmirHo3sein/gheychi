import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotification } from '../admin-notifications/admin-notification.entity';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { AlertsService } from '../alerts/alerts.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { Salon } from '../salons/salon.entity';
import { Worker } from '../salons/worker.entity';
import { SmsModule } from '../sms/sms.module';
import { WalletBalance } from '../wallet/wallet-balance.entity';
import { WalletTransaction } from '../wallet/wallet-transaction.entity';
import { WalletService } from '../wallet/wallet.service';
import { AdminReferralRewardTypesController, AdminReferralsController } from './admin-referrals.controller';
import { ReferralCode } from './referral-code.entity';
import { ReferralRewardType } from './referral-reward-type.entity';
import { ReferralReward } from './referral-reward.entity';
import { Referral } from './referral.entity';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [
    // Salon and Worker are registered directly here (not via `import SalonsModule`)
    // for the exact reason AuthModule already registers `Salon` directly instead of
    // importing SalonsModule: SalonsModule needs ReferralsService too (the
    // salons/mine/workers/:id/referral-code endpoint), and if ReferralsModule imported
    // SalonsModule back, that would be a second module cycle on top of the
    // AuthModule<->ReferralsModule one below. Same precedent as WorkerRating being
    // registered in both ReviewsModule and SalonsModule. ReferralReward is this
    // slice's own new entity (no cycle risk). WalletBalance/WalletTransaction are
    // registered directly here too (rather than `import WalletModule`) for the exact
    // same reason: WalletModule itself imports AuthModule, and AuthModule already
    // forwardRef()s ReferralsModule -- importing WalletModule here would close a
    // THIRD cycle leg (ReferralsModule -> WalletModule -> AuthModule -> (forwardRef)
    // ReferralsModule) that forwardRef on just the existing AuthModule<->ReferralsModule
    // edge doesn't cover, since WalletModule's own AuthModule import is a plain,
    // eager one. Registering the entities directly and providing WalletService below
    // sidesteps the extra module edge entirely. AdminNotification is registered for
    // the identical reason one level further out: AlertsModule imports
    // AdminNotificationsModule, which ALSO imports AuthModule plainly -- so importing
    // AlertsModule here would reopen the same kind of cycle one hop further down
    // (ReferralsModule -> AlertsModule -> AdminNotificationsModule -> AuthModule ->
    // (forwardRef) ReferralsModule).
    TypeOrmModule.forFeature([
      ReferralCode, ReferralRewardType, Referral, ReferralReward, Salon, Worker,
      WalletBalance, WalletTransaction, AdminNotification,
    ]),
    // Genuine bidirectional dependency, not avoidable by the "register entities
    // directly" trick used above: AuthModule needs ReferralsService (verify-otp
    // redemption, run inside the registration transaction) and ReferralsModule's own
    // controllers need AuthGuard/RolesGuard from AuthModule. forwardRef() on both
    // sides (see auth.module.ts) breaks the resulting require-cycle.
    forwardRef(() => AuthModule),
    AuditModule,
    // SmsModule has no path back to AuthModule/ReferralsModule -- safe to import
    // directly (AlertsService needs SMS_PROVIDER for its critical-severity paging).
    SmsModule,
  ],
  controllers: [ReferralsController, AdminReferralRewardTypesController, AdminReferralsController],
  // WalletService/AdminNotificationsService/AlertsService provided directly (see the
  // TypeOrmModule.forFeature comment above) -- functionally identical to their home
  // modules' own instances (all three are thin, stateless wrappers over their
  // injected repositories/providers), just avoiding the extra module edges.
  providers: [ReferralsService, WalletService, AdminNotificationsService, AlertsService],
  // BookingModule (slice 4: reward granting, wired into booking-completion/payment
  // flows) needs ReferralsService directly.
  exports: [ReferralsService, TypeOrmModule],
})
export class ReferralsModule {}

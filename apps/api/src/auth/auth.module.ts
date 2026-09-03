import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { Salon } from '../salons/salon.entity';
import { SmsModule } from '../sms/sms.module';
import { AdminUsersController } from '../users/admin-users.controller';
import { AdminUsersService } from '../users/admin-users.service';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { assertProductionJwtSecret } from './jwt-secret.util';
import { OtpService } from './otp.service';
import { SessionRevocationService } from './session-revocation.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    UsersModule,
    SmsModule,
    AuditModule,
    AnalyticsModule,
    TypeOrmModule.forFeature([User, Salon]),
    // Genuine bidirectional dependency (see the matching comment in
    // referrals.module.ts): AuthController.verifyOtp needs ReferralsService to redeem
    // a referral code inside the registration transaction, and ReferralsModule's own
    // controllers need AuthGuard/RolesGuard from this module. forwardRef() on both
    // sides breaks the resulting require-cycle.
    forwardRef(() => ReferralsModule),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: assertProductionJwtSecret(config.getOrThrow('JWT_SECRET'), config.get('NODE_ENV')),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController, AdminUsersController],
  providers: [OtpService, AuthGuard, RolesGuard, AdminUsersService, SessionRevocationService],
  exports: [OtpService, AuthGuard, RolesGuard, UsersModule, SessionRevocationService],
})
export class AuthModule {}

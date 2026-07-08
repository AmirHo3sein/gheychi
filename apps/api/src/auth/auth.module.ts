import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { AdminUsersController } from '../users/admin-users.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { OtpService } from './otp.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    UsersModule,
    SmsModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController, AdminUsersController],
  providers: [OtpService, AuthGuard, RolesGuard],
  exports: [OtpService, AuthGuard, RolesGuard, UsersModule],
})
export class AuthModule {}

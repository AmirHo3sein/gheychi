import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Salon } from '../salons/salon.entity';
import { SmsModule } from '../sms/sms.module';
import { AdminUsersController } from '../users/admin-users.controller';
import { AdminUsersService } from '../users/admin-users.service';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { OtpService } from './otp.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    UsersModule,
    SmsModule,
    AuditModule,
    TypeOrmModule.forFeature([User, Salon]),
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
  providers: [OtpService, AuthGuard, RolesGuard, AdminUsersService],
  exports: [OtpService, AuthGuard, RolesGuard, UsersModule],
})
export class AuthModule {}

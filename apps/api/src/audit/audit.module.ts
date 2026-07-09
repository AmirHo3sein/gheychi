import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AdminAuditController } from './admin-audit.controller';
import { AuditLog } from './audit-log.entity';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

@Module({
  // UsersModule (NOT AuthModule -- AuthModule imports AuditModule, importing it back
  // would create a module cycle) supplies UsersService for AuthGuard and the User
  // repository token for AuditService's actor lookup.
  imports: [TypeOrmModule.forFeature([AuditLog]), UsersModule],
  controllers: [AdminAuditController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}

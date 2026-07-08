import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminConfigController } from './admin-config.controller';
import { PlatformConfig } from './platform-config.entity';
import { PlatformConfigController } from './platform-config.controller';
import { PlatformConfigService } from './platform-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformConfig]), AuthModule],
  controllers: [PlatformConfigController, AdminConfigController],
  providers: [PlatformConfigService],
  exports: [PlatformConfigService],
})
export class PlatformConfigModule {}

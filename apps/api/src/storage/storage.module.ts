import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDiskStorageProvider } from './local-disk-storage.provider';
import { STORAGE_PROVIDER } from './storage.provider';

@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new LocalDiskStorageProvider(config.get('APP_BASE_URL', 'http://localhost:3002')),
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}

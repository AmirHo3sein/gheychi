import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDiskStorageProvider } from './local-disk-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import { STORAGE_PROVIDER } from './storage.provider';
import { StorageReconciliationJob } from './storage-reconciliation.job';

@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('STORAGE_PROVIDER') === 's3'
          ? new S3StorageProvider(
              config.getOrThrow('S3_BUCKET'),
              config.getOrThrow('S3_PUBLIC_BASE_URL'),
              config.getOrThrow('S3_ENDPOINT'),
              config.getOrThrow('S3_REGION'),
              config.getOrThrow('S3_ACCESS_KEY_ID'),
              config.getOrThrow('S3_SECRET_ACCESS_KEY'),
            )
          : new LocalDiskStorageProvider(config.get('APP_BASE_URL', 'http://localhost:3002')),
    },
    StorageReconciliationJob,
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}

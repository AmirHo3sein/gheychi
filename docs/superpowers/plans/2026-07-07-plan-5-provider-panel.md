# Plan 5 — Provider Panel (Vue 3 + Vite SPA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the salon-owner-facing Provider Panel: a Vue 3 + Vite SPA covering onboarding, bookings, services, hours, photos, reviews, and earnings, plus the two bounded backend additions (photo upload storage + an earnings endpoint) it needs.

**Architecture:** Nearly all provider CRUD already exists via `/salons/mine/*` in `apps/api`. This plan adds a new `StorageProvider` abstraction (mirrors the existing SMS/payment/push provider pattern) for photo upload, a new earnings-aggregation endpoint, and a brand-new `apps/provider-panel` frontend that talks only to `apps/api` — no shared runtime with `apps/user-app`.

**Tech Stack:** NestJS additions in `apps/api` (multer, `@aws-sdk/client-s3`); new `apps/provider-panel` on Vue 3.5 + Vite + vue-router 4 + Pinia + Tailwind CSS v4, Vitest + Playwright for tests.

**Design doc:** `docs/superpowers/specs/2026-07-07-provider-panel-design.md`

---

## Backend additions (`apps/api`)

### Task 1: CORS support for multiple frontend origins

**Files:**
- Create: `apps/api/src/cors-origins.util.ts`
- Test: `apps/api/src/cors-origins.util.spec.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/.env.example` (add `PROVIDER_APP_BASE_URL`)

Today `main.ts` only allows one CORS origin (`FRONTEND_BASE_URL`, the user-app). Provider Panel will run on a different origin (`http://localhost:3004` in dev) and needs credentialed cross-origin requests to work too.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/cors-origins.util.spec.ts
import { ConfigService } from '@nestjs/config';
import { buildAllowedOrigins } from './cors-origins.util';

describe('buildAllowedOrigins', () => {
  it('defaults to the known user-app and provider-panel dev ports', () => {
    const config = new ConfigService({});
    expect(buildAllowedOrigins(config)).toEqual(['http://localhost:3003', 'http://localhost:3004']);
  });

  it('uses configured env vars when set', () => {
    const config = new ConfigService({
      FRONTEND_BASE_URL: 'https://app.arayeshgah.ir',
      PROVIDER_APP_BASE_URL: 'https://provider.arayeshgah.ir',
    });
    expect(buildAllowedOrigins(config)).toEqual([
      'https://app.arayeshgah.ir',
      'https://provider.arayeshgah.ir',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- cors-origins.util`
Expected: FAIL with "Cannot find module './cors-origins.util'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/cors-origins.util.ts
import { ConfigService } from '@nestjs/config';

export function buildAllowedOrigins(config: ConfigService): string[] {
  return [
    config.get('FRONTEND_BASE_URL', 'http://localhost:3003'),
    config.get('PROVIDER_APP_BASE_URL', 'http://localhost:3004'),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- cors-origins.util`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire it into `main.ts`**

In `apps/api/src/main.ts`, add the import and replace the `enableCors` call:

```typescript
import { buildAllowedOrigins } from './cors-origins.util';
```

```typescript
  app.enableCors({
    origin: buildAllowedOrigins(nestConfig),
    credentials: true,
  });
```

- [ ] **Step 6: Add the new env var to `.env.example`**

Append to `apps/api/.env.example`:

```
PROVIDER_APP_BASE_URL=http://localhost:3004
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/cors-origins.util.ts apps/api/src/cors-origins.util.spec.ts apps/api/src/main.ts apps/api/.env.example
git commit -m "feat(api): allow CORS from the provider-panel origin as well as user-app"
```

---

### Task 2: StorageProvider abstraction + local-disk implementation

**Files:**
- Create: `apps/api/src/storage/storage.provider.ts`
- Create: `apps/api/src/storage/local-disk-storage.provider.ts`
- Test: `apps/api/src/storage/local-disk-storage.provider.spec.ts`
- Create: `apps/api/src/storage/storage.module.ts`

Follows the exact interface-token-factory pattern already used for `SmsProvider`/`PaymentGateway`/`PushProvider`.

- [ ] **Step 1: Define the interface and token**

```typescript
// apps/api/src/storage/storage.provider.ts
export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

export interface StorageProvider {
  upload(buffer: Buffer, key: string, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test for the local-disk implementation**

```typescript
// apps/api/src/storage/local-disk-storage.provider.spec.ts
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalDiskStorageProvider } from './local-disk-storage.provider';

describe('LocalDiskStorageProvider', () => {
  let root: string;
  let provider: LocalDiskStorageProvider;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'arayeshgah-storage-test-'));
    provider = new LocalDiskStorageProvider('http://localhost:3002', root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the buffer under the given key and returns a public URL', async () => {
    const url = await provider.upload(Buffer.from('fake-image-bytes'), 'salons/abc/photo.jpg', 'image/jpeg');
    expect(url).toBe('http://localhost:3002/uploads/salons/abc/photo.jpg');
    expect(existsSync(join(root, 'salons/abc/photo.jpg'))).toBe(true);
  });

  it('creates nested directories for the key as needed', async () => {
    await provider.upload(Buffer.from('x'), 'salons/new-salon-id/deep/photo.jpg', 'image/jpeg');
    expect(existsSync(join(root, 'salons/new-salon-id/deep/photo.jpg'))).toBe(true);
  });

  it('deletes the file for a given key', async () => {
    await provider.upload(Buffer.from('x'), 'salons/abc/photo.jpg', 'image/jpeg');
    await provider.delete('salons/abc/photo.jpg');
    expect(existsSync(join(root, 'salons/abc/photo.jpg'))).toBe(false);
  });

  it('does not throw when deleting a key that was never uploaded', async () => {
    await expect(provider.delete('salons/never/uploaded.jpg')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- local-disk-storage.provider`
Expected: FAIL with "Cannot find module './local-disk-storage.provider'"

- [ ] **Step 4: Write minimal implementation**

```typescript
// apps/api/src/storage/local-disk-storage.provider.ts
import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { StorageProvider } from './storage.provider';

@Injectable()
export class LocalDiskStorageProvider implements StorageProvider {
  constructor(
    private readonly publicBaseUrl: string,
    private readonly root: string = join(process.cwd(), 'uploads'),
  ) {}

  async upload(buffer: Buffer, key: string): Promise<string> {
    const filePath = join(this.root, key);
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return `${this.publicBaseUrl}/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    await fs.rm(join(this.root, key), { force: true });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- local-disk-storage.provider`
Expected: PASS (4 tests)

- [ ] **Step 6: Wire the module (local-only for now; S3 branch added in Task 3)**

```typescript
// apps/api/src/storage/storage.module.ts
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
```

- [ ] **Step 7: Serve the local uploads directory as static files**

In `apps/api/src/main.ts`, change the bootstrap to use `NestExpressApplication` and serve `/uploads`:

```typescript
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
```

```typescript
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
```

```typescript
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
```
(add this line right after `app.use(cookieParser())`)

- [ ] **Step 8: Add `uploads/` to `.gitignore`**

Append to the root `.gitignore`:

```
apps/api/uploads/
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/storage apps/api/src/main.ts .gitignore
git commit -m "feat(api): add StorageProvider abstraction with a local-disk implementation"
```

---

### Task 3: S3-compatible StorageProvider implementation

**Files:**
- Modify: `apps/api/package.json` (add `@aws-sdk/client-s3`)
- Create: `apps/api/src/storage/s3-storage.provider.ts`
- Test: `apps/api/src/storage/s3-storage.provider.spec.ts`
- Modify: `apps/api/src/storage/storage.module.ts`
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @arayeshgah/api add @aws-sdk/client-s3
```

- [ ] **Step 2: Write the failing test (mocking the S3 client, same style as `zarinpal-payment.gateway.spec.ts` mocking `fetch`)**

```typescript
// apps/api/src/storage/s3-storage.provider.spec.ts
import { S3Client } from '@aws-sdk/client-s3';
import { S3StorageProvider } from './s3-storage.provider';

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn().mockResolvedValue({});
  return {
    S3Client: jest.fn(() => ({ send })),
    PutObjectCommand: jest.fn((input) => ({ input })),
    DeleteObjectCommand: jest.fn((input) => ({ input })),
  };
});

describe('S3StorageProvider', () => {
  const provider = new S3StorageProvider(
    'arayeshgah-photos',
    'https://cdn.example.com',
    'https://s3.example.com',
    'us-east-1',
    'access-key',
    'secret-key',
  );

  it('uploads via PutObjectCommand and returns a public URL built from the bucket key', async () => {
    const url = await provider.upload(Buffer.from('bytes'), 'salons/abc/photo.jpg', 'image/jpeg');
    expect(url).toBe('https://cdn.example.com/salons/abc/photo.jpg');

    const clientInstance = (S3Client as unknown as jest.Mock).mock.results[0].value;
    expect(clientInstance.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ Bucket: 'arayeshgah-photos', Key: 'salons/abc/photo.jpg' }),
      }),
    );
  });

  it('deletes via DeleteObjectCommand', async () => {
    await provider.delete('salons/abc/photo.jpg');
    const clientInstance = (S3Client as unknown as jest.Mock).mock.results[0].value;
    expect(clientInstance.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ Bucket: 'arayeshgah-photos', Key: 'salons/abc/photo.jpg' }),
      }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- s3-storage.provider`
Expected: FAIL with "Cannot find module './s3-storage.provider'"

- [ ] **Step 4: Write minimal implementation**

```typescript
// apps/api/src/storage/s3-storage.provider.ts
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { StorageProvider } from './storage.provider';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly publicBaseUrl: string,
    endpoint: string,
    region: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  async upload(buffer: Buffer, key: string, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
    );
    return `${this.publicBaseUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- s3-storage.provider`
Expected: PASS (2 tests)

- [ ] **Step 6: Wire the S3 branch into the module**

Replace the contents of `apps/api/src/storage/storage.module.ts`:

```typescript
// apps/api/src/storage/storage.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDiskStorageProvider } from './local-disk-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';
import { STORAGE_PROVIDER } from './storage.provider';

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
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
```

- [ ] **Step 7: Document the new env vars**

Append to `apps/api/.env.example`:

```
STORAGE_PROVIDER=local
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_BASE_URL=
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/pnpm-lock.yaml apps/api/src/storage apps/api/.env.example
git commit -m "feat(api): add an S3-compatible StorageProvider implementation, selectable via STORAGE_PROVIDER"
```

---

### Task 4: Salon photo write endpoints

**Files:**
- Create: `apps/api/src/migrations/1752100000000-salon-photo-storage-key.ts`
- Modify: `apps/api/src/salons/salon-photo.entity.ts`
- Create: `apps/api/src/salons/dto/salon-photo.dto.ts`
- Create: `apps/api/src/salons/salon-photos.controller.ts`
- Modify: `apps/api/src/salons/salons.module.ts`
- Modify: `apps/api/package.json` (add `multer`, `@types/multer`)
- Test: `apps/api/test/salon-photos.e2e-spec.ts`

The `SalonPhoto` entity/table and the public read endpoint (`GET /salons/:slug/photos`) already exist from Plan 4. This task adds the provider-facing write side, plus a `storage_key` column so deletes/updates don't have to reverse-engineer a storage key from the public URL.

- [ ] **Step 1: Add multer dependencies**

```bash
pnpm --filter @arayeshgah/api add multer
pnpm --filter @arayeshgah/api add -D @types/multer
```

- [ ] **Step 2: Write the migration**

```typescript
// apps/api/src/migrations/1752100000000-salon-photo-storage-key.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class SalonPhotoStorageKey1752100000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salon_photos ADD COLUMN storage_key varchar NOT NULL DEFAULT ''`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salon_photos DROP COLUMN storage_key`);
  }
}
```

- [ ] **Step 3: Run the migration against the dev database**

Run: `pnpm --filter @arayeshgah/api migration:run`
Expected: `Migration SalonPhotoStorageKey1752100000000 has been executed successfully.`

- [ ] **Step 4: Add the field to the entity**

In `apps/api/src/salons/salon-photo.entity.ts`, add after the `isCover` column:

```typescript
  @Column({ name: 'storage_key' })
  storageKey: string;
```

- [ ] **Step 5: Write the DTO**

```typescript
// apps/api/src/salons/dto/salon-photo.dto.ts
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateSalonPhotoDto {
  @IsOptional()
  @IsBoolean()
  isCover?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
```

- [ ] **Step 6: Write the failing e2e test**

```typescript
// apps/api/test/salon-photos.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon photos (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09122220001');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Photo Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 2',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  let photoId: string;

  it('uploads a photo, marking the first one as cover', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    photoId = res.body.id;
    expect(res.body.isCover).toBe(true);
    expect(res.body.url).toContain('/uploads/');
  });

  it('rejects a non-image upload', () =>
    request(app.getHttpServer())
      .post('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('not an image'), { filename: 'a.txt', contentType: 'text/plain' })
      .expect(422));

  it('lists photos for the caller salon', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBe(1);
  });

  it('updates sortOrder/isCover', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/photos/${photoId}`)
      .set('Cookie', cookie)
      .send({ sortOrder: 3 })
      .expect(200);
    expect(res.body.sortOrder).toBe(3);
  });

  it('deletes a photo', async () => {
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/photos/${photoId}`)
      .set('Cookie', cookie)
      .expect(204);
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/photos')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBe(0);
  });

  it('rejects unauthenticated access', () =>
    request(app.getHttpServer()).get('/api/salons/mine/photos').expect(401));
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- salon-photos`
Expected: FAIL — `Cannot GET/POST /api/salons/mine/photos` (404, controller doesn't exist yet)

- [ ] **Step 8: Write the controller**

```typescript
// apps/api/src/salons/salon-photos.controller.ts
import { randomUUID } from 'crypto';
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, NotFoundException, Param,
  ParseFilePipeBuilder, ParseUUIDPipe, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
import { UpdateSalonPhotoDto } from './dto/salon-photo.dto';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonPhoto } from './salon-photo.entity';

@Controller('salons/mine/photos')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonPhotosController {
  constructor(
    @InjectRepository(SalonPhoto) private readonly photos: Repository<SalonPhoto>,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  @Get()
  list(@Req() req: Request) {
    return this.photos.find({ where: { salonId: req.salonId }, order: { isCover: 'DESC', sortOrder: 'ASC' } });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @Req() req: Request,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    const salonId = req.salonId!;
    const count = await this.photos.count({ where: { salonId } });
    const key = `salons/${salonId}/${randomUUID()}-${file.originalname}`;
    const url = await this.storage.upload(file.buffer, key, file.mimetype);
    return this.photos.save(
      this.photos.create({ salonId, url, storageKey: key, sortOrder: count, isCover: count === 0 }),
    );
  }

  @Patch(':id')
  async update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSalonPhotoDto) {
    const photo = await this.photos.findOneBy({ id, salonId: req.salonId });
    if (!photo) throw new NotFoundException();
    Object.assign(photo, dto);
    return this.photos.save(photo);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const photo = await this.photos.findOneBy({ id, salonId: req.salonId });
    if (!photo) throw new NotFoundException();
    await this.photos.delete({ id });
    // Best-effort: the DB row is the source of truth for what's shown in the gallery; an
    // orphaned object left in storage after a delete failure is a harmless cleanup gap,
    // not a user-visible bug (same class of tradeoff as this codebase's SMS/push sends).
    await this.storage.delete(photo.storageKey).catch(() => {});
  }
}
```

- [ ] **Step 9: Wire the controller and `StorageModule` into `SalonsModule`**

In `apps/api/src/salons/salons.module.ts`, add the import and registration:

```typescript
import { StorageModule } from '../storage/storage.module';
import { SalonPhotosController } from './salon-photos.controller';
```

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([Salon, SalonService, WorkingHour, ScheduleException, SalonPhoto]),
    AuthModule,
    StorageModule,
  ],
  controllers: [
    SalonServicesController,
    ScheduleController,
    SalonPhotosController,
    SalonsController,
    AdminSalonsController,
    SitemapSalonsController,
    // PublicSalonContentController owns wildcard routes shaped `salons/:slug/...` (e.g. services, hours).
    // NestJS/Express matches routes in registration order, not by specificity, so it MUST stay registered
    // after any controller with a literal `salons/mine/...`-shaped route of the same depth (currently
    // SalonServicesController, ScheduleController, SalonPhotosController) or it will silently shadow them.
    PublicSalonContentController,
  ],
  providers: [SalonsService, SalonOwnerGuard],
  exports: [SalonsService, SalonOwnerGuard, TypeOrmModule],
})
export class SalonsModule {}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- salon-photos`
Expected: PASS (6 tests)

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/migrations/1752100000000-salon-photo-storage-key.ts apps/api/src/salons/salon-photo.entity.ts apps/api/src/salons/dto/salon-photo.dto.ts apps/api/src/salons/salon-photos.controller.ts apps/api/src/salons/salons.module.ts apps/api/test/salon-photos.e2e-spec.ts apps/api/package.json apps/api/pnpm-lock.yaml
git commit -m "feat(api): add provider-facing salon photo upload/update/delete endpoints"
```

---

### Task 5: Salon earnings endpoint

**Files:**
- Modify: `apps/api/src/booking/bookings.service.ts`
- Test: `apps/api/src/booking/bookings.service.spec.ts` (new)
- Modify: `apps/api/src/booking/salon-bookings.controller.ts`
- Test: `apps/api/test/salon-earnings.e2e-spec.ts`

Earnings = sum of `paid` payments for the salon's bookings, minus `platform_config.commission_percent`. No new payment infrastructure — this is read-only aggregation over `Booking`/`Payment` rows that already exist.

- [ ] **Step 1: Write the failing unit test for the aggregation method**

```typescript
// apps/api/src/booking/bookings.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { REDIS } from '../redis/redis.module';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Booking } from './booking.entity';
import { Payment } from './payment.entity';
import { BookingsService } from './bookings.service';
import { Salon } from '../salons/salon.entity';
import { SalonService } from '../salons/salon-service.entity';

describe('BookingsService.getEarnings', () => {
  let service: BookingsService;
  let paymentsFind: jest.Mock;

  beforeEach(async () => {
    paymentsFind = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Payment), useValue: { find: paymentsFind } },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: 'DataSource', useValue: {} },
        { provide: PlatformConfigService, useValue: { getCommissionPercent: jest.fn().mockResolvedValue(10) } },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('sums paid payments for the salon and deducts commission', async () => {
    paymentsFind.mockResolvedValue([
      { amount: 100_000, status: 'paid' },
      { amount: 200_000, status: 'paid' },
    ]);

    const result = await service.getEarnings('salon-1');

    expect(result.totalCollected).toBe(300_000);
    expect(result.commissionPercent).toBe(10);
    expect(result.commissionAmount).toBe(30_000);
    expect(result.netPayout).toBe(270_000);
  });

  it('returns zeros when there are no paid payments yet', async () => {
    paymentsFind.mockResolvedValue([]);

    const result = await service.getEarnings('salon-1');

    expect(result).toEqual({
      totalCollected: 0,
      commissionPercent: 10,
      commissionAmount: 0,
      netPayout: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test -- bookings.service.spec`
Expected: FAIL with "service.getEarnings is not a function"

- [ ] **Step 3: Add the method to `BookingsService`**

In `apps/api/src/booking/bookings.service.ts`, add this method (near `listForSalon`):

```typescript
  async getEarnings(salonId: string): Promise<{
    totalCollected: number;
    commissionPercent: number;
    commissionAmount: number;
    netPayout: number;
  }> {
    const bookings = await this.bookings.find({ where: { salonId }, select: ['id'] });
    const bookingIds = bookings.map((b) => b.id);
    const paidPayments = bookingIds.length
      ? await this.payments.find({ where: { bookingId: In(bookingIds), status: 'paid' } })
      : [];

    const totalCollected = paidPayments.reduce((sum, p) => sum + p.amount, 0);
    const commissionPercent = await this.config.getCommissionPercent();
    const commissionAmount = Math.round((totalCollected * commissionPercent) / 100);

    return {
      totalCollected,
      commissionPercent,
      commissionAmount,
      netPayout: totalCollected - commissionAmount,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test -- bookings.service.spec`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing e2e test for the endpoint**

```typescript
// apps/api/test/salon-earnings.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon earnings (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09122220002');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Earnings Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 3',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns zeroed earnings for a brand-new salon with no bookings', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/earnings')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body).toEqual({ totalCollected: 0, commissionPercent: 10, commissionAmount: 0, netPayout: 0 });
  });

  it('rejects unauthenticated access', () =>
    request(app.getHttpServer()).get('/api/salons/mine/earnings').expect(401));
});
```

(`commission_percent` is seeded at `10` by the initial-schema migration — confirm the seeded value in `src/migrations/1751600000000-initial-schema.ts` if this assertion ever fails.)

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/api test:e2e -- salon-earnings`
Expected: FAIL — `Cannot GET /api/salons/mine/earnings` (404, route doesn't exist yet)

- [ ] **Step 7: Add a new controller for the route (mirrors how `SalonBookingsController`/`SalonServicesController` are separate controllers within the same module for the same resource family)**

```typescript
// apps/api/src/booking/salon-earnings.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { BookingsService } from './bookings.service';

@Controller('salons/mine/earnings')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonEarningsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  earnings(@Req() req: Request) {
    return this.bookings.getEarnings(req.salonId!);
  }
}
```

- [ ] **Step 8: Register the new controller**

In `apps/api/src/booking/booking.module.ts`, add the import and registration:

```typescript
import { SalonEarningsController } from './salon-earnings.controller';
```

```typescript
  controllers: [AvailabilityController, BookingsController, PaymentsController, SalonBookingsController, SalonEarningsController],
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/api test:e2e -- salon-earnings`
Expected: PASS (2 tests)

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/booking/bookings.service.ts apps/api/src/booking/bookings.service.spec.ts apps/api/src/booking/salon-earnings.controller.ts apps/api/src/booking/booking.module.ts apps/api/test/salon-earnings.e2e-spec.ts
git commit -m "feat(api): add GET /salons/mine/earnings aggregating paid deposits minus commission"
```

---

### Task 6: Document the backend additions in the root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a new section after "## Reviews & moderation (Plan 3)" and before "## User app (Plan 4)"**

```markdown
## Provider panel backend additions (Plan 5)

- `POST /api/salons/mine/photos` — upload a salon photo (multipart `file` field, jpeg/png/webp, 5MB max); the first photo uploaded is automatically marked cover. `PATCH /api/salons/mine/photos/:id` (isCover/sortOrder), `DELETE /api/salons/mine/photos/:id`.
- Photo storage goes through a swappable `StorageProvider` (`STORAGE_PROVIDER=local|s3`, same pattern as `SmsProvider`/`PaymentGateway`/`PushProvider`) — `local` writes under `apps/api/uploads/` and serves it at `/uploads/*`; `s3` talks to any S3-compatible bucket via `S3_ENDPOINT`/`S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_PUBLIC_BASE_URL`.
- `GET /api/salons/mine/earnings` — `{ totalCollected, commissionPercent, commissionAmount, netPayout }`, computed from `paid` payments on the caller's own bookings. No new payment infrastructure; purely aggregates existing `Booking`/`Payment` rows.
- CORS now allows both `FRONTEND_BASE_URL` (user-app) and `PROVIDER_APP_BASE_URL` (provider-panel) as credentialed origins.
- **No salon-approval workflow was added.** `GET /api/salons/mine` already returns `status`, which is all the provider-panel needs to show a "pending review" screen — `pending → approved` is still a manual DB update, same as before this plan.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the Plan 5 provider-panel backend additions"
```

---

## Frontend (`apps/provider-panel`)

### Task 7: Scaffold the Vite + Vue 3 project

**Files:**
- Create: `apps/provider-panel/package.json`
- Create: `apps/provider-panel/vite.config.ts`
- Create: `apps/provider-panel/tsconfig.json`
- Create: `apps/provider-panel/tsconfig.app.json`
- Create: `apps/provider-panel/tsconfig.node.json`
- Create: `apps/provider-panel/index.html`
- Create: `apps/provider-panel/src/main.ts`
- Create: `apps/provider-panel/src/App.vue`
- Create: `apps/provider-panel/.env.example`
- Modify: `package.json` (root — add `dev:provider-panel` script)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@arayeshgah/provider-panel",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 3004",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "vue-tsc -b --noEmit"
  },
  "dependencies": {
    "@fontsource-variable/vazirmatn": "^5.2.8",
    "@tailwindcss/vite": "^4.3.2",
    "pinia": "^3.0.4",
    "tailwindcss": "^4.3.2",
    "vue": "^3.5.13",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.1",
    "@types/node": "^22.10.0",
    "@vitejs/plugin-vue": "^5.2.1",
    "@vue/test-utils": "^2.4.6",
    "happy-dom": "^15.11.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.2.6",
    "vue-tsc": "^3.3.6"
  }
}
```

- [ ] **Step 2: Write `vite.config.ts`**

```typescript
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3004,
  },
})
```

- [ ] **Step 3: Write the TypeScript project configs**

```json
// apps/provider-panel/tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

```json
// apps/provider-panel/tsconfig.app.json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "composite": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.vue"]
}
```

```json
// apps/provider-panel/tsconfig.node.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"],
    "composite": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Write `index.html`**

```html
<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>پنل مدیریت آرایشگاه</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `src/App.vue` and `src/main.ts`**

```vue
<!-- apps/provider-panel/src/App.vue -->
<script setup lang="ts"></script>

<template>
  <RouterView />
</template>
```

```typescript
// apps/provider-panel/src/main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createWebHistory } from 'vue-router'
import App from './App.vue'
import { createAppRouter } from './router'
import './assets/css/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(createAppRouter(createWebHistory()))
app.mount('#app')
```

(`src/router/index.ts` is created in Task 11 — this file won't compile until then, which is fine since nothing runs it yet.)

- [ ] **Step 6: Write `.env.example`**

```
VITE_API_BASE=http://localhost:3002/api
VITE_NESHAN_API_KEY=
```

- [ ] **Step 7: Add the root dev script**

In the root `package.json`, add to `scripts`:

```json
    "dev:provider-panel": "turbo run dev --filter=@arayeshgah/provider-panel",
```

- [ ] **Step 8: Install dependencies**

Run: `pnpm install`
Expected: resolves and links the new `@arayeshgah/provider-panel` workspace package

- [ ] **Step 9: Commit**

```bash
git add apps/provider-panel package.json pnpm-lock.yaml
git commit -m "feat(provider-panel): scaffold the Vite + Vue 3 project"
```

---

### Task 8: Tailwind setup and design tokens

**Files:**
- Create: `apps/provider-panel/src/assets/css/main.css`

Reuses user-app's "Teal Trust" light-theme tokens for brand consistency (design doc §2) — single theme only, no dark mode.

- [ ] **Step 1: Write the stylesheet**

```css
/* apps/provider-panel/src/assets/css/main.css */
@import "tailwindcss";
@import "@fontsource-variable/vazirmatn/wght.css";

@theme static {
  --font-sans: 'Vazirmatn Variable', ui-sans-serif, system-ui, sans-serif;

  /* "Teal Trust" -- same brand tokens as user-app's light theme (single theme, no dark mode) */
  --color-surface: #F4FBFA;
  --color-surface-card: #FFFFFF;
  --color-text: #0B4F4A;
  --color-accent: #0EA89B;
}

html, body {
  background-color: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-sans);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/provider-panel/src/assets/css/main.css
git commit -m "feat(provider-panel): add Tailwind v4 setup with shared brand tokens"
```

---

### Task 9: `useApi` and `useToast` composables

**Files:**
- Create: `apps/provider-panel/src/composables/useToast.ts`
- Test: `apps/provider-panel/src/composables/useToast.spec.ts`
- Create: `apps/provider-panel/src/composables/useApi.ts`
- Test: `apps/provider-panel/src/composables/useApi.spec.ts`
- Create: `apps/provider-panel/vitest.config.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```typescript
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
  },
})
```

- [ ] **Step 2: Write the failing test for `useToast`**

```typescript
// apps/provider-panel/src/composables/useToast.spec.ts
import { describe, expect, it, vi } from 'vitest'
import { useToast } from './useToast'

describe('useToast', () => {
  it('pushes a message and auto-dismisses it after 5s', () => {
    vi.useFakeTimers()
    const { toasts, push } = useToast()
    const before = toasts.value.length

    push('hello')
    expect(toasts.value.length).toBe(before + 1)

    vi.advanceTimersByTime(5000)
    expect(toasts.value.length).toBe(before)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: FAIL with "Cannot find module './useToast'"

- [ ] **Step 4: Write minimal implementation**

```typescript
// apps/provider-panel/src/composables/useToast.ts
import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
}

const toasts = ref<Toast[]>([])
let counter = 0

export function useToast() {
  function push(message: string) {
    const id = counter++
    toasts.value.push({ id, message })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 5000)
  }

  return { toasts, push }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (1 test)

- [ ] **Step 6: Write the failing tests for `useApi`**

```typescript
// apps/provider-panel/src/composables/useApi.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApi } from './useApi'

describe('useApi', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed JSON data on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '1' }),
    }))

    const { apiFetch } = useApi()
    const { data, error } = await apiFetch('/salons/mine')

    expect(data).toEqual({ id: '1' })
    expect(error).toBeNull()
  })

  it('redirects to /login on a 401 by default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    }))

    const { apiFetch } = useApi()
    await apiFetch('/salons/mine')

    expect(window.location.href).toBe('/login')
  })

  it('does not redirect on 401 when redirectOn401 is false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    }))

    const { apiFetch } = useApi()
    await apiFetch('/salons/mine', { redirectOn401: false })

    expect(window.location.href).toBe('')
  })

  it('sends FormData bodies without a Content-Type header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const form = new FormData()
    const { apiFetch } = useApi()
    await apiFetch('/salons/mine/photos', { method: 'POST', body: form })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: form, headers: undefined }),
    )
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: FAIL with "Cannot find module './useApi'"

- [ ] **Step 8: Write minimal implementation**

```typescript
// apps/provider-panel/src/composables/useApi.ts
import { useToast } from './useToast'

export interface ApiError {
  status: number
  message: string
}

export interface ApiResult<T> {
  data: T | null
  error: ApiError | null
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  silent?: boolean
  /** Set to false to suppress the automatic redirect-to-/login on a 401 (defaults to true). */
  redirectOn401?: boolean
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3002/api'

export function useApi() {
  async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<ApiResult<T>> {
    const isFormData = options.body instanceof FormData

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: options.method ?? 'GET',
        credentials: 'include',
        headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
        body:
          options.body === undefined
            ? undefined
            : isFormData
              ? (options.body as FormData)
              : JSON.stringify(options.body),
      })

      if (!res.ok) {
        let message = 'Something went wrong'
        try {
          message = (await res.json())?.message ?? message
        } catch {
          // response body wasn't JSON -- keep the default message
        }
        const apiError: ApiError = { status: res.status, message }

        if (apiError.status === 401) {
          if (options.redirectOn401 !== false) window.location.href = '/login'
          return { data: null, error: apiError }
        }

        if (!options.silent) useToast().push(message)
        return { data: null, error: apiError }
      }

      const data = res.status === 204 ? null : ((await res.json()) as T)
      return { data, error: null }
    } catch {
      const apiError: ApiError = { status: 0, message: 'Network error' }
      if (!options.silent) useToast().push(apiError.message)
      return { data: null, error: apiError }
    }
  }

  return { apiFetch }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (5 tests total, this file + useToast)

- [ ] **Step 10: Commit**

```bash
git add apps/provider-panel/src/composables/useToast.ts apps/provider-panel/src/composables/useToast.spec.ts apps/provider-panel/src/composables/useApi.ts apps/provider-panel/src/composables/useApi.spec.ts apps/provider-panel/vitest.config.ts
git commit -m "feat(provider-panel): add useApi and useToast composables"
```

---

### Task 10: Pinia session store and `useSalon` composable

**Files:**
- Create: `apps/provider-panel/src/stores/session.ts`
- Create: `apps/provider-panel/src/composables/useSalon.ts`
- Test: `apps/provider-panel/src/composables/useSalon.spec.ts`

- [ ] **Step 1: Write the session store**

```typescript
// apps/provider-panel/src/stores/session.ts
import { defineStore } from 'pinia'

export interface SessionUser {
  id: string
  phone: string
  name: string | null
  gender: 'female' | 'male' | null
  role: 'customer' | 'provider' | 'admin'
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    user: null as SessionUser | null,
    checked: false, // becomes true once we've asked the API at least once this session
  }),
  getters: {
    isLoggedIn: (state) => !!state.user,
  },
  actions: {
    setUser(user: SessionUser | null) {
      this.user = user
      this.checked = true
    },
  },
})
```

- [ ] **Step 2: Write the failing test for `useSalon`**

```typescript
// apps/provider-panel/src/composables/useSalon.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSalon } from './useSalon'

describe('useSalon', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets salon to the fetched value on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 's1', status: 'pending' }),
    }))

    const { salon, checked, refetch } = useSalon()
    await refetch()

    expect(checked.value).toBe(true)
    expect(salon.value).toEqual({ id: 's1', status: 'pending' })
  })

  it('sets salon to null when the caller has no salon yet (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'No salon for this account' }),
    }))

    const { salon, refetch } = useSalon()
    await refetch()

    expect(salon.value).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: FAIL with "Cannot find module './useSalon'"

- [ ] **Step 4: Write minimal implementation**

```typescript
// apps/provider-panel/src/composables/useSalon.ts
import { ref } from 'vue'
import { useApi } from './useApi'

export interface Salon {
  id: string
  name: string
  slug: string
  status: 'pending' | 'approved' | 'suspended'
  genderTarget: 'women' | 'men'
  address: string
  city: string
  capacity: number
}

const salon = ref<Salon | null>(null)
const checked = ref(false)

export function useSalon() {
  const { apiFetch } = useApi()

  async function refetch(): Promise<void> {
    const { data } = await apiFetch<Salon>('/salons/mine', { silent: true, redirectOn401: false })
    salon.value = data
    checked.value = true
  }

  return { salon, checked, refetch }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (7 tests total)

- [ ] **Step 6: Commit**

```bash
git add apps/provider-panel/src/stores/session.ts apps/provider-panel/src/composables/useSalon.ts apps/provider-panel/src/composables/useSalon.spec.ts
git commit -m "feat(provider-panel): add session store and useSalon composable"
```

---

### Task 11: Router with auth and salon-status guards

**Files:**
- Create: `apps/provider-panel/src/router/index.ts`
- Test: `apps/provider-panel/src/router/index.spec.ts`

The guard order matters: unauthenticated → `/login`; authenticated with no salon → `/onboarding`; authenticated with a non-approved salon → `/pending-approval`; otherwise the requested route. Page components referenced by dynamic `import()` don't need to exist for this task's own test — they're mocked.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/provider-panel/src/router/index.spec.ts
import { createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/stores/session'
import { createAppRouter } from './index'

vi.mock('@/pages/LoginView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/OnboardingView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/PendingApprovalView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/DashboardView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/BookingsView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/ServicesView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/HoursView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/PhotosView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/ReviewsView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/pages/EarningsView.vue', () => ({ default: { template: '<div />' } }))

describe('router guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('redirects an unauthenticated visitor to /login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    const router = createAppRouter(createMemoryHistory())
    await router.push('/bookings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('sends a logged-in provider with no salon yet to /onboarding', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'u1', role: 'customer' }) })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: null, gender: null, role: 'customer' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/bookings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('onboarding')
  })

  it('sends a provider with a pending salon to /pending-approval', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/bookings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('pending-approval')
  })

  it('allows a provider with an approved salon through to the requested route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'approved' }) }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/bookings')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('bookings')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: FAIL with "Cannot find module './index'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/provider-panel/src/router/index.ts
import { createRouter, type RouterHistory, type Router } from 'vue-router'
import type { SessionUser } from '@/stores/session'
import { useSessionStore } from '@/stores/session'
import { useSalon } from '@/composables/useSalon'
import { useApi } from '@/composables/useApi'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/pages/LoginView.vue'), meta: { public: true } },
  { path: '/onboarding', name: 'onboarding', component: () => import('@/pages/OnboardingView.vue') },
  { path: '/pending-approval', name: 'pending-approval', component: () => import('@/pages/PendingApprovalView.vue') },
  { path: '/', name: 'dashboard', component: () => import('@/pages/DashboardView.vue') },
  { path: '/bookings', name: 'bookings', component: () => import('@/pages/BookingsView.vue') },
  { path: '/services', name: 'services', component: () => import('@/pages/ServicesView.vue') },
  { path: '/hours', name: 'hours', component: () => import('@/pages/HoursView.vue') },
  { path: '/photos', name: 'photos', component: () => import('@/pages/PhotosView.vue') },
  { path: '/reviews', name: 'reviews', component: () => import('@/pages/ReviewsView.vue') },
  { path: '/earnings', name: 'earnings', component: () => import('@/pages/EarningsView.vue') },
]

export function createAppRouter(history: RouterHistory): Router {
  const router = createRouter({ history, routes })

  router.beforeEach(async (to) => {
    const session = useSessionStore()

    if (!session.checked) {
      const { apiFetch } = useApi()
      const { data } = await apiFetch<SessionUser>('/auth/me', { silent: true, redirectOn401: false })
      session.setUser(data)
    }

    if (to.meta.public) {
      return session.isLoggedIn ? { name: 'dashboard' } : true
    }

    if (!session.isLoggedIn) {
      return { name: 'login' }
    }

    const { salon, checked, refetch } = useSalon()
    if (!checked.value) await refetch()

    if (!salon.value) {
      return to.name === 'onboarding' ? true : { name: 'onboarding' }
    }

    if (salon.value.status !== 'approved') {
      return to.name === 'pending-approval' ? true : { name: 'pending-approval' }
    }

    if (to.name === 'onboarding' || to.name === 'pending-approval') {
      return { name: 'dashboard' }
    }

    return true
  })

  return router
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (4 tests in this file; 11 total)

- [ ] **Step 5: Commit**

```bash
git add apps/provider-panel/src/router
git commit -m "feat(provider-panel): add router with auth and salon-status guards"
```

---

### Task 12: `LoginView` (phone + OTP)

**Files:**
- Create: `apps/provider-panel/src/pages/LoginView.vue`
- Test: `apps/provider-panel/src/pages/LoginView.spec.ts`

Same phone → OTP flow/endpoints as user-app (`/auth/request-otp`, `/auth/verify-otp`) — separate implementation, no shared code between the two apps.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/provider-panel/src/pages/LoginView.spec.ts
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginView from './LoginView.vue'
import { useSessionStore } from '@/stores/session'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/', name: 'dashboard', component: { template: '<div />' } },
    ],
  })
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests an OTP then verifies it, landing on the dashboard', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) }) // request-otp
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ user: { id: 'u1', phone: '09120000000', name: 'Sara', gender: 'female', role: 'provider' } }),
      }) // verify-otp
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="phone-input"]').setValue('09120000000')
    await wrapper.find('[data-testid="phone-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(true)

    await wrapper.find('[data-testid="code-input"]').setValue('1234')
    await wrapper.find('[data-testid="code-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))
    await router.isReady()

    expect(useSessionStore().isLoggedIn).toBe(true)
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('shows an error and stays on the phone step when request-otp fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'bad phone' }) }))

    const router = makeRouter()
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="phone-input"]').setValue('123')
    await wrapper.find('[data-testid="phone-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('شماره موبایل نامعتبر است')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: FAIL with "Cannot find module './LoginView.vue'"

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- apps/provider-panel/src/pages/LoginView.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useSessionStore, type SessionUser } from '@/stores/session'

const router = useRouter()
const { apiFetch } = useApi()
const session = useSessionStore()

const step = ref<'phone' | 'code'>('phone')
const phone = ref('')
const code = ref('')
const submitting = ref(false)
const formError = ref('')

async function requestOtp() {
  submitting.value = true
  formError.value = ''
  const { error } = await apiFetch('/auth/request-otp', { method: 'POST', body: { phone: phone.value }, silent: true })
  submitting.value = false
  if (error) {
    formError.value = 'شماره موبایل نامعتبر است'
    return
  }
  step.value = 'code'
}

async function verifyOtp() {
  submitting.value = true
  formError.value = ''
  const { data, error } = await apiFetch<{ user: SessionUser }>(
    '/auth/verify-otp',
    { method: 'POST', body: { phone: phone.value, code: code.value }, silent: true },
  )
  submitting.value = false
  if (error || !data) {
    formError.value = 'کد وارد شده اشتباه است'
    return
  }

  session.setUser(data.user)
  await router.push('/')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-sm space-y-4">
      <h1 class="text-xl font-bold text-center">ورود به پنل مدیریت آرایشگاه</h1>

      <form v-if="step === 'phone'" data-testid="phone-form" class="space-y-3" @submit.prevent="requestOtp">
        <input
          data-testid="phone-input"
          v-model="phone"
          type="tel"
          placeholder="شماره موبایل"
          class="w-full rounded-lg border p-3"
        />
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <button type="submit" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-3">
          دریافت کد
        </button>
      </form>

      <form v-else data-testid="code-form" class="space-y-3" @submit.prevent="verifyOtp">
        <input
          data-testid="code-input"
          v-model="code"
          type="text"
          inputmode="numeric"
          placeholder="کد تایید"
          class="w-full rounded-lg border p-3"
        />
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <button type="submit" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-3">
          ورود
        </button>
      </form>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (2 tests in this file; 13 total)

- [ ] **Step 5: Commit**

```bash
git add apps/provider-panel/src/pages/LoginView.vue apps/provider-panel/src/pages/LoginView.spec.ts
git commit -m "feat(provider-panel): add phone+OTP LoginView"
```

---

### Task 13: Map pin picker (`SalonPinPicker`)

**Files:**
- Create: `apps/provider-panel/src/components/onboarding/SalonPinPicker.vue`

Reuses the exact Neshan SDK loading pattern from user-app's `SalonMap.client.vue` (script/link injection, `window.L` global). Unlike that display-only component, this one places a single **draggable, click-to-move** marker and emits its coordinates — no geocoding of any kind is needed (address is a separate free-text field the provider types themselves), which is what resolves the design doc's "map pin-drop is new territory" open risk: this only ever reads coordinates back off a Leaflet marker, it never calls a Neshan geocoding endpoint.

No dedicated unit test for this component — it's a thin wrapper around a third-party SDK loaded via injected `<script>` tags, the same class of component as `SalonMap.client.vue`, which also has no test in user-app for the same reason (nothing meaningful to assert without a real browser + real SDK).

- [ ] **Step 1: Write the component**

```vue
<!-- apps/provider-panel/src/components/onboarding/SalonPinPicker.vue -->
<script lang="ts">
// Module-scope singleton -- avoids injecting a duplicate <script>/<link> pair if this
// component is ever mounted more than once before the first load's onload/onerror fires.
let sdkPromise: Promise<void> | null = null
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

const props = defineProps<{
  modelValue: { lat: number; lng: number } | null
  center: { lat: number; lng: number }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: { lat: number; lng: number }]
}>()

const mapEl = useTemplateRef<HTMLDivElement>('mapEl')
const loadFailed = ref(false)

let mapInstance: any = null
let marker: any = null
let isMounted = false

function loadNeshanSdk(): Promise<void> {
  const w = window as unknown as { L?: unknown }
  if (w.L) return Promise.resolve()
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.js'
    script.onload = () => resolve()
    script.onerror = () => {
      sdkPromise = null
      reject(new Error('Failed to load Neshan SDK'))
    }
    document.head.appendChild(script)
  })
  return sdkPromise
}

onMounted(async () => {
  isMounted = true
  try {
    await loadNeshanSdk()
  } catch {
    loadFailed.value = true
    // Default to the city-center coordinates so a map/network failure doesn't hard-block
    // the rest of onboarding -- the manual lat/lng inputs (shown below) let the provider
    // correct this later from the same screen, or from the salon settings after approval.
    if (!props.modelValue) emit('update:modelValue', { lat: props.center.lat, lng: props.center.lng })
    return
  }
  if (!isMounted || !mapEl.value) return

  const L = (window as unknown as { L: any }).L
  const start = props.modelValue ?? props.center

  mapInstance = new L.Map(mapEl.value, {
    key: import.meta.env.VITE_NESHAN_API_KEY,
    maptype: 'standard-day',
    center: [start.lat, start.lng],
    zoom: 13,
    poi: false,
    traffic: false,
  })

  marker = L.marker([start.lat, start.lng], { draggable: true }).addTo(mapInstance)
  marker.on('dragend', () => {
    const pos = marker.getLatLng()
    emit('update:modelValue', { lat: pos.lat, lng: pos.lng })
  })
  mapInstance.on('click', (e: { latlng: { lat: number; lng: number } }) => {
    marker.setLatLng(e.latlng)
    emit('update:modelValue', { lat: e.latlng.lat, lng: e.latlng.lng })
  })

  if (!props.modelValue) {
    emit('update:modelValue', { lat: start.lat, lng: start.lng })
  }
})

onBeforeUnmount(() => {
  isMounted = false
  mapInstance?.remove?.()
})
</script>

<template>
  <div>
    <div v-if="!loadFailed" ref="mapEl" class="h-72 w-full rounded-xl" />
    <div v-else class="space-y-2 rounded-xl border p-3">
      <p class="text-sm text-red-600">
        نقشه بارگذاری نشد. مختصات را به‌صورت دستی وارد کنید (بعداً هم قابل ویرایش است).
      </p>
      <div class="flex gap-2">
        <input
          data-testid="manual-lat"
          type="number"
          step="any"
          :value="modelValue?.lat ?? center.lat"
          placeholder="عرض جغرافیایی"
          class="flex-1 rounded-lg border p-2"
          @change="emit('update:modelValue', { lat: +($event.target as HTMLInputElement).value, lng: modelValue?.lng ?? center.lng })"
        />
        <input
          data-testid="manual-lng"
          type="number"
          step="any"
          :value="modelValue?.lng ?? center.lng"
          placeholder="طول جغرافیایی"
          class="flex-1 rounded-lg border p-2"
          @change="emit('update:modelValue', { lat: modelValue?.lat ?? center.lat, lng: +($event.target as HTMLInputElement).value })"
        />
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add apps/provider-panel/src/components/onboarding/SalonPinPicker.vue
git commit -m "feat(provider-panel): add draggable map pin picker for onboarding"
```

---

### Task 14: Onboarding wizard — salon info & schedule steps

**Files:**
- Create: `apps/provider-panel/src/components/onboarding/SalonInfoStep.vue`
- Create: `apps/provider-panel/src/components/onboarding/ScheduleStep.vue`
- Create: `apps/provider-panel/src/pages/OnboardingView.vue`
- Test: `apps/provider-panel/src/pages/OnboardingView.spec.ts`

- [ ] **Step 1: Write `SalonInfoStep.vue`**

```vue
<!-- apps/provider-panel/src/components/onboarding/SalonInfoStep.vue -->
<script setup lang="ts">
import SalonPinPicker from './SalonPinPicker.vue'

const model = defineModel<{
  name: string
  description: string
  genderTarget: 'women' | 'men' | ''
  address: string
  city: string
  capacity: number
  lat: number | null
  lng: number | null
}>({ required: true })

function onPin(pos: { lat: number; lng: number }) {
  model.value.lat = pos.lat
  model.value.lng = pos.lng
}
</script>

<template>
  <div class="space-y-3">
    <input v-model="model.name" data-testid="salon-name" placeholder="نام آرایشگاه" class="w-full rounded-lg border p-3" />
    <textarea v-model="model.description" placeholder="توضیحات (اختیاری)" class="w-full rounded-lg border p-3" />
    <select v-model="model.genderTarget" data-testid="gender-target" class="w-full rounded-lg border p-3">
      <option value="" disabled>مخاطب آرایشگاه</option>
      <option value="women">بانوان</option>
      <option value="men">آقایان</option>
    </select>
    <input v-model="model.city" data-testid="city" placeholder="شهر" class="w-full rounded-lg border p-3" />
    <input v-model="model.address" data-testid="address" placeholder="آدرس" class="w-full rounded-lg border p-3" />
    <input
      v-model.number="model.capacity"
      type="number"
      min="1"
      max="50"
      placeholder="ظرفیت همزمان"
      class="w-full rounded-lg border p-3"
    />
    <SalonPinPicker
      :model-value="model.lat !== null && model.lng !== null ? { lat: model.lat, lng: model.lng } : null"
      :center="{ lat: 35.7, lng: 51.4 }"
      @update:model-value="onPin"
    />
  </div>
</template>
```

- [ ] **Step 2: Write `ScheduleStep.vue`**

```vue
<!-- apps/provider-panel/src/components/onboarding/ScheduleStep.vue -->
<script setup lang="ts">
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

const model = defineModel<Array<{ weekday: number; openTime: string; closeTime: string; enabled: boolean }>>({
  required: true,
})
</script>

<template>
  <div class="space-y-2">
    <div v-for="day in model" :key="day.weekday" class="flex items-center gap-2" :data-testid="`day-${day.weekday}`">
      <label class="flex w-24 items-center gap-2">
        <input v-model="day.enabled" type="checkbox" />
        {{ WEEKDAYS[day.weekday] }}
      </label>
      <input v-model="day.openTime" :disabled="!day.enabled" type="time" class="rounded-lg border p-2" />
      <span>تا</span>
      <input v-model="day.closeTime" :disabled="!day.enabled" type="time" class="rounded-lg border p-2" />
    </div>
  </div>
</template>
```

- [ ] **Step 3: Write the failing test for step-gating in `OnboardingView`**

```typescript
// apps/provider-panel/src/pages/OnboardingView.spec.ts
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingView from './OnboardingView.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/onboarding', name: 'onboarding', component: OnboardingView },
      { path: '/pending-approval', name: 'pending-approval', component: { template: '<div />' } },
    ],
  })
}

describe('OnboardingView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the next button disabled until the salon-info step is complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    const next = wrapper.find('[data-testid="wizard-next"]')
    expect((next.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await wrapper.find('[data-testid="gender-target"]').setValue('women')
    await wrapper.find('[data-testid="city"]').setValue('تهران')
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    // The map pin picker doesn't run in jsdom/happy-dom (no real Neshan SDK) -- set the
    // coordinates directly the way the picker's @update:model-value handler would.
    await wrapper.setData({ form: { salonInfo: { lat: 35.7, lng: 51.4 } } })

    expect((next.element as HTMLButtonElement).disabled).toBe(false)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: FAIL with "Cannot find module './OnboardingView.vue'"

- [ ] **Step 5: Write the wizard shell (steps 1-2 only; Task 15 adds step 3 and submit)**

```vue
<!-- apps/provider-panel/src/pages/OnboardingView.vue -->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'
import ScheduleStep from '@/components/onboarding/ScheduleStep.vue'

const step = ref(1)

const form = reactive({
  salonInfo: {
    name: '',
    description: '',
    genderTarget: '' as 'women' | 'men' | '',
    address: '',
    city: '',
    capacity: 1,
    lat: null as number | null,
    lng: null as number | null,
  },
  hours: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openTime: '09:00',
    closeTime: '20:00',
    enabled: false,
  })),
})

const isSalonInfoValid = computed(
  () =>
    form.salonInfo.name.trim().length >= 2 &&
    form.salonInfo.genderTarget !== '' &&
    form.salonInfo.city.trim().length > 0 &&
    form.salonInfo.address.trim().length > 0 &&
    form.salonInfo.lat !== null &&
    form.salonInfo.lng !== null,
)

const canGoNext = computed(() => (step.value === 1 ? isSalonInfoValid.value : true))

function next() {
  if (canGoNext.value) step.value++
}
function back() {
  if (step.value > 1) step.value--
}
</script>

<template>
  <div class="mx-auto max-w-md p-6">
    <SalonInfoStep v-if="step === 1" v-model="form.salonInfo" />
    <ScheduleStep v-else-if="step === 2" v-model="form.hours" />

    <div class="mt-4 flex justify-between">
      <button v-if="step > 1" type="button" class="rounded-lg border px-4 py-2" @click="back">قبلی</button>
      <button
        v-if="step < 3"
        data-testid="wizard-next"
        type="button"
        :disabled="!canGoNext"
        class="rounded-lg bg-(--color-accent) px-4 py-2 text-white disabled:opacity-40"
        @click="next"
      >
        بعدی
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (1 test in this file; 14 total)

- [ ] **Step 7: Commit**

```bash
git add apps/provider-panel/src/components/onboarding/SalonInfoStep.vue apps/provider-panel/src/components/onboarding/ScheduleStep.vue apps/provider-panel/src/pages/OnboardingView.vue apps/provider-panel/src/pages/OnboardingView.spec.ts
git commit -m "feat(provider-panel): add onboarding wizard salon-info and schedule steps"
```

---

### Task 15: Onboarding wizard — first service step and submit

**Files:**
- Create: `apps/provider-panel/src/components/onboarding/FirstServiceStep.vue`
- Modify: `apps/provider-panel/src/pages/OnboardingView.vue`
- Modify: `apps/provider-panel/src/pages/OnboardingView.spec.ts`

Submits the whole wizard as three sequential API calls: `POST /salons`, then `PUT /salons/mine/hours` (only if any day was enabled), then `POST /salons/mine/services`. The salon exists after the first call succeeds — there's no draft-save/resume in v1 (accepted risk in the design doc), so if a later call fails, the provider is still sent to the pending-approval screen and can finish hours/services later from their regular views instead of restarting the wizard.

- [ ] **Step 1: Write `FirstServiceStep.vue`**

```vue
<!-- apps/provider-panel/src/components/onboarding/FirstServiceStep.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

const model = defineModel<{ categoryId: number | null; name: string; price: number; durationMin: number }>({
  required: true,
})

const { apiFetch } = useApi()
const categories = ref<{ id: number; name: string }[]>([])

onMounted(async () => {
  const { data } = await apiFetch<{ id: number; name: string }[]>('/categories', { silent: true })
  categories.value = data ?? []
})
</script>

<template>
  <div class="space-y-3">
    <select v-model.number="model.categoryId" data-testid="service-category" class="w-full rounded-lg border p-3">
      <option :value="null" disabled>دسته‌بندی خدمت</option>
      <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
    </select>
    <input v-model="model.name" data-testid="service-name" placeholder="نام خدمت" class="w-full rounded-lg border p-3" />
    <input
      v-model.number="model.price"
      data-testid="service-price"
      type="number"
      min="0"
      placeholder="قیمت (تومان)"
      class="w-full rounded-lg border p-3"
    />
    <input
      v-model.number="model.durationMin"
      data-testid="service-duration"
      type="number"
      min="5"
      max="600"
      placeholder="مدت زمان (دقیقه)"
      class="w-full rounded-lg border p-3"
    />
  </div>
</template>
```

- [ ] **Step 2: Extend the failing test to cover step 3 and submit**

Append to `apps/provider-panel/src/pages/OnboardingView.spec.ts`:

```typescript
  it('submits salon, hours, and first service in order, then lands on pending-approval', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 1, name: 'رنگ مو' }]) }) // categories (mounted on step 3)
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 's1' }) }) // POST /salons
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // PUT hours
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'sv1' }) }) // POST services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) }) // refetch salon
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await wrapper.find('[data-testid="gender-target"]').setValue('women')
    await wrapper.find('[data-testid="city"]').setValue('تهران')
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await wrapper.setData({ form: { salonInfo: { lat: 35.7, lng: 51.4 } } })
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    await wrapper.find('[data-testid="day-0"] input[type=checkbox]').setValue(true)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    await wrapper.find('[data-testid="service-category"]').setValue('1')
    await wrapper.find('[data-testid="service-name"]').setValue('رنگ مو')
    await wrapper.find('[data-testid="service-price"]').setValue('500000')
    await wrapper.find('[data-testid="service-duration"]').setValue('60')
    await wrapper.find('[data-testid="wizard-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await router.isReady()

    expect(fetchMock.mock.calls[1]![0]).toContain('/salons')
    expect(fetchMock.mock.calls[2]![0]).toContain('/salons/mine/hours')
    expect(fetchMock.mock.calls[3]![0]).toContain('/salons/mine/services')
    expect(router.currentRoute.value.name).toBe('pending-approval')
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: FAIL — no step 3 / no submit button yet

- [ ] **Step 4: Add step 3 and the submit handler to `OnboardingView.vue`**

Replace the `<script setup>` block in `apps/provider-panel/src/pages/OnboardingView.vue`:

```vue
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'
import ScheduleStep from '@/components/onboarding/ScheduleStep.vue'
import FirstServiceStep from '@/components/onboarding/FirstServiceStep.vue'
import { useApi } from '@/composables/useApi'
import { useSalon } from '@/composables/useSalon'

const router = useRouter()
const { apiFetch } = useApi()
const { refetch } = useSalon()

const step = ref(1)
const submitting = ref(false)
const submitError = ref('')

const form = reactive({
  salonInfo: {
    name: '',
    description: '',
    genderTarget: '' as 'women' | 'men' | '',
    address: '',
    city: '',
    capacity: 1,
    lat: null as number | null,
    lng: null as number | null,
  },
  hours: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openTime: '09:00',
    closeTime: '20:00',
    enabled: false,
  })),
  service: {
    categoryId: null as number | null,
    name: '',
    price: 0,
    durationMin: 30,
  },
})

const isSalonInfoValid = computed(
  () =>
    form.salonInfo.name.trim().length >= 2 &&
    form.salonInfo.genderTarget !== '' &&
    form.salonInfo.city.trim().length > 0 &&
    form.salonInfo.address.trim().length > 0 &&
    form.salonInfo.lat !== null &&
    form.salonInfo.lng !== null,
)

const isServiceValid = computed(
  () => form.service.categoryId !== null && form.service.name.trim().length >= 2 && form.service.durationMin >= 5,
)

const canGoNext = computed(() => (step.value === 1 ? isSalonInfoValid.value : true))

function next() {
  if (canGoNext.value) step.value++
}
function back() {
  if (step.value > 1) step.value--
}

async function submit() {
  if (!isServiceValid.value) return
  submitting.value = true
  submitError.value = ''

  const { data: salon, error: salonError } = await apiFetch<{ id: string }>('/salons', {
    method: 'POST',
    body: {
      name: form.salonInfo.name,
      description: form.salonInfo.description || undefined,
      genderTarget: form.salonInfo.genderTarget,
      address: form.salonInfo.address,
      city: form.salonInfo.city,
      capacity: form.salonInfo.capacity,
      lat: form.salonInfo.lat,
      lng: form.salonInfo.lng,
    },
    silent: true,
  })
  if (salonError || !salon) {
    submitError.value = 'ثبت اطلاعات آرایشگاه ناموفق بود. دوباره تلاش کنید.'
    submitting.value = false
    return
  }

  const enabledHours = form.hours
    .filter((h) => h.enabled)
    .map(({ weekday, openTime, closeTime }) => ({ weekday, openTime, closeTime }))
  if (enabledHours.length) {
    await apiFetch('/salons/mine/hours', { method: 'PUT', body: { hours: enabledHours }, silent: true })
  }

  await apiFetch('/salons/mine/services', { method: 'POST', body: form.service, silent: true })

  await refetch()
  await router.push('/pending-approval')
}
</script>
```

Replace the `<template>` block:

```vue
<template>
  <div class="mx-auto max-w-md p-6">
    <SalonInfoStep v-if="step === 1" v-model="form.salonInfo" />
    <ScheduleStep v-else-if="step === 2" v-model="form.hours" />
    <FirstServiceStep v-else v-model="form.service" />

    <p v-if="submitError" class="mt-2 text-sm text-red-600">{{ submitError }}</p>

    <div class="mt-4 flex justify-between">
      <button v-if="step > 1" type="button" class="rounded-lg border px-4 py-2" @click="back">قبلی</button>
      <button
        v-if="step < 3"
        data-testid="wizard-next"
        type="button"
        :disabled="!canGoNext"
        class="rounded-lg bg-(--color-accent) px-4 py-2 text-white disabled:opacity-40"
        @click="next"
      >
        بعدی
      </button>
      <button
        v-else
        data-testid="wizard-submit"
        type="button"
        :disabled="!isServiceValid || submitting"
        class="rounded-lg bg-(--color-accent) px-4 py-2 text-white disabled:opacity-40"
        @click="submit"
      >
        ثبت و ارسال برای بررسی
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (2 tests in this file; 15 total)

- [ ] **Step 6: Commit**

```bash
git add apps/provider-panel/src/components/onboarding/FirstServiceStep.vue apps/provider-panel/src/pages/OnboardingView.vue apps/provider-panel/src/pages/OnboardingView.spec.ts
git commit -m "feat(provider-panel): add first-service step and wizard submit flow"
```

---

### Task 16: `PendingApprovalView`

**Files:**
- Create: `apps/provider-panel/src/pages/PendingApprovalView.vue`
- Test: `apps/provider-panel/src/pages/PendingApprovalView.spec.ts`

Shown by the router guard whenever the caller has a salon but its `status !== 'approved'` — covers both a fresh `pending` onboarding and a `suspended` salon. Manual refresh only, no polling (design doc §3/§4).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/provider-panel/src/pages/PendingApprovalView.spec.ts
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PendingApprovalView from './PendingApprovalView.vue'

describe('PendingApprovalView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a pending message for a pending salon', () => {
    vi.stubGlobal('fetch', vi.fn())
    const wrapper = mount(PendingApprovalView, {
      global: { provide: {} },
      props: {},
    })
    expect(wrapper.text()).toContain('بررسی')
  })

  it('re-fetches the salon when the refresh button is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'approved' }) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PendingApprovalView)
    await wrapper.find('[data-testid="refresh-status"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/salons/mine'), expect.anything())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: FAIL with "Cannot find module './PendingApprovalView.vue'"

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- apps/provider-panel/src/pages/PendingApprovalView.vue -->
<script setup lang="ts">
import { useSalon } from '@/composables/useSalon'

const { salon, refetch } = useSalon()
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 class="text-xl font-bold">
      {{ salon?.status === 'suspended' ? 'آرایشگاه شما معلق شده است' : 'آرایشگاه شما در حال بررسی است' }}
    </h1>
    <p class="text-sm">
      {{
        salon?.status === 'suspended'
          ? 'برای اطلاعات بیشتر با پشتیبانی تماس بگیرید.'
          : 'به محض تایید توسط تیم آرایشگاه، به شما اطلاع داده می‌شود.'
      }}
    </p>
    <button data-testid="refresh-status" type="button" class="rounded-lg border px-4 py-2" @click="refetch">
      بررسی وضعیت
    </button>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (2 tests in this file; 17 total)

- [ ] **Step 5: Commit**

```bash
git add apps/provider-panel/src/pages/PendingApprovalView.vue apps/provider-panel/src/pages/PendingApprovalView.spec.ts
git commit -m "feat(provider-panel): add pending-approval screen"
```

---

### Task 17: App layout and bottom navigation

**Files:**
- Create: `apps/provider-panel/src/components/layout/AppLayout.vue`
- Create: `apps/provider-panel/src/components/layout/BottomNav.vue`
- Modify: `apps/provider-panel/src/App.vue`

Mobile-first bottom nav with 5 tabs (Dashboard/Bookings/Services/Reviews/Earnings), per design doc §3. Hours and Photos are reachable from Dashboard's settings entry point (added in Task 18), not the tab bar.

- [ ] **Step 1: Write `BottomNav.vue`**

```vue
<!-- apps/provider-panel/src/components/layout/BottomNav.vue -->
<script setup lang="ts">
const TABS = [
  { to: '/', label: 'داشبورد' },
  { to: '/bookings', label: 'نوبت‌ها' },
  { to: '/services', label: 'خدمات' },
  { to: '/reviews', label: 'نظرات' },
  { to: '/earnings', label: 'درآمد' },
]
</script>

<template>
  <nav class="fixed inset-x-0 bottom-0 flex border-t bg-(--color-surface-card)">
    <RouterLink
      v-for="tab in TABS"
      :key="tab.to"
      :to="tab.to"
      class="flex-1 py-3 text-center text-sm"
      active-class="text-(--color-accent) font-bold"
    >
      {{ tab.label }}
    </RouterLink>
  </nav>
</template>
```

- [ ] **Step 2: Write `AppLayout.vue`**

```vue
<!-- apps/provider-panel/src/components/layout/AppLayout.vue -->
<script setup lang="ts"></script>

<template>
  <div class="min-h-screen pb-16">
    <RouterView />
    <BottomNav />
  </div>
</template>

<script lang="ts">
import BottomNav from './BottomNav.vue'
export default { components: { BottomNav } }
</script>
```

- [ ] **Step 3: Update the router to wrap the authenticated routes in the layout**

In `apps/provider-panel/src/router/index.ts`, restructure `routes` so the tab-bar pages are children of a layout route (login/onboarding/pending-approval stay outside it, since they don't show the bottom nav):

```typescript
import AppLayout from '@/components/layout/AppLayout.vue'
```

```typescript
const routes = [
  { path: '/login', name: 'login', component: () => import('@/pages/LoginView.vue'), meta: { public: true } },
  { path: '/onboarding', name: 'onboarding', component: () => import('@/pages/OnboardingView.vue') },
  { path: '/pending-approval', name: 'pending-approval', component: () => import('@/pages/PendingApprovalView.vue') },
  {
    path: '/',
    component: AppLayout,
    children: [
      { path: '', name: 'dashboard', component: () => import('@/pages/DashboardView.vue') },
      { path: 'bookings', name: 'bookings', component: () => import('@/pages/BookingsView.vue') },
      { path: 'services', name: 'services', component: () => import('@/pages/ServicesView.vue') },
      { path: 'hours', name: 'hours', component: () => import('@/pages/HoursView.vue') },
      { path: 'photos', name: 'photos', component: () => import('@/pages/PhotosView.vue') },
      { path: 'reviews', name: 'reviews', component: () => import('@/pages/ReviewsView.vue') },
      { path: 'earnings', name: 'earnings', component: () => import('@/pages/EarningsView.vue') },
    ],
  },
]
```

- [ ] **Step 4: Re-run the full test suite to confirm the router restructure didn't break the Task 11 guard tests**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (all 17 tests still passing — the guard logic itself didn't change, only how routes are nested)

- [ ] **Step 5: Commit**

```bash
git add apps/provider-panel/src/components/layout apps/provider-panel/src/router/index.ts
git commit -m "feat(provider-panel): add app layout with bottom navigation"
```

---

### Task 18: `DashboardView`

**Files:**
- Create: `apps/provider-panel/src/pages/DashboardView.vue`

Today's bookings + next few upcoming appointments (design doc §3). No dedicated spec test — the design doc's Testing section (§5) scopes component tests to onboarding steps, the photo uploader, and booking status actions; this view is a plain read-only list with no branching logic worth isolating.

- [ ] **Step 1: Write the component**

```vue
<!-- apps/provider-panel/src/pages/DashboardView.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface Booking {
  id: string
  serviceId: string
  startsAt: string
  status: string
}
interface Service {
  id: string
  name: string
}

const { apiFetch } = useApi()
const bookings = ref<Booking[]>([])
const services = ref<Service[]>([])
const loading = ref(true)

onMounted(async () => {
  const [bookingsRes, servicesRes] = await Promise.all([
    apiFetch<Booking[]>('/salons/mine/bookings', { silent: true }),
    apiFetch<Service[]>('/salons/mine/services', { silent: true }),
  ])
  bookings.value = bookingsRes.data ?? []
  services.value = servicesRes.data ?? []
  loading.value = false
})

function serviceName(id: string) {
  return services.value.find((s) => s.id === id)?.name ?? '—'
}

const todayKey = new Date().toDateString()

const todaysBookings = computed(() =>
  bookings.value
    .filter((b) => b.status === 'confirmed' && new Date(b.startsAt).toDateString() === todayKey)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
)

const upcomingBookings = computed(() =>
  bookings.value
    .filter((b) => b.status === 'confirmed' && new Date(b.startsAt) > new Date())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 5),
)
</script>

<template>
  <div class="space-y-6 p-4">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-bold">داشبورد</h1>
      <div class="flex gap-3 text-sm">
        <RouterLink to="/hours">ساعات کاری</RouterLink>
        <RouterLink to="/photos">تصاویر</RouterLink>
      </div>
    </div>

    <section>
      <h2 class="mb-2 font-bold">نوبت‌های امروز</h2>
      <p v-if="!loading && todaysBookings.length === 0" class="text-sm text-gray-500">نوبتی برای امروز ثبت نشده است.</p>
      <ul class="space-y-2">
        <li v-for="b in todaysBookings" :key="b.id" class="rounded-lg border p-3">
          {{ serviceName(b.serviceId) }} — {{ new Date(b.startsAt).toLocaleTimeString('fa-IR') }}
        </li>
      </ul>
    </section>

    <section>
      <h2 class="mb-2 font-bold">نوبت‌های بعدی</h2>
      <ul class="space-y-2">
        <li v-for="b in upcomingBookings" :key="b.id" class="rounded-lg border p-3">
          {{ serviceName(b.serviceId) }} — {{ new Date(b.startsAt).toLocaleDateString('fa-IR') }}
        </li>
      </ul>
    </section>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add apps/provider-panel/src/pages/DashboardView.vue
git commit -m "feat(provider-panel): add dashboard view"
```

---

### Task 19: `BookingsView` (mark completed/no-show, cancel)

**Files:**
- Create: `apps/provider-panel/src/pages/BookingsView.vue`
- Test: `apps/provider-panel/src/pages/BookingsView.spec.ts`

This is the "booking status actions" component the design doc's Testing section calls out explicitly.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/provider-panel/src/pages/BookingsView.spec.ts
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BookingsView from './BookingsView.vue'

describe('BookingsView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks a confirmed booking completed and reloads the list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed' }]),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // PATCH
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', startsAt: '2026-08-01T09:00:00.000Z', status: 'completed' }]),
      })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="mark-completed"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[1]![0]).toContain('/salons/mine/bookings/b1')
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
  })

  it('only asks for cancel confirmation, then calls the cancel endpoint if confirmed', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ([{ id: 'b1', serviceId: 's1', startsAt: '2026-08-01T09:00:00.000Z', status: 'confirmed' }]),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }) // POST cancel
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BookingsView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="cancel-booking"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[1]![0]).toContain('/bookings/b1/cancel')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: FAIL with "Cannot find module './BookingsView.vue'"

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- apps/provider-panel/src/pages/BookingsView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface Booking {
  id: string
  serviceId: string
  startsAt: string
  status: string
}

const { apiFetch } = useApi()
const bookings = ref<Booking[]>([])

async function load() {
  const { data } = await apiFetch<Booking[]>('/salons/mine/bookings', { silent: true })
  bookings.value = data ?? []
}

onMounted(load)

async function markStatus(id: string, status: 'completed' | 'no_show') {
  await apiFetch(`/salons/mine/bookings/${id}`, { method: 'PATCH', body: { status } })
  await load()
}

async function cancelBooking(id: string) {
  if (!confirm('لغو این نوبت ممکن است مشمول جریمه شود. ادامه می‌دهید؟')) return
  await apiFetch(`/bookings/${id}/cancel`, { method: 'POST' })
  await load()
}
</script>

<template>
  <div class="space-y-3 p-4">
    <h1 class="text-lg font-bold">نوبت‌ها</h1>
    <div v-for="b in bookings" :key="b.id" :data-testid="`booking-${b.id}`" class="rounded-lg border p-3">
      <p>{{ new Date(b.startsAt).toLocaleString('fa-IR') }} — {{ b.status }}</p>
      <div v-if="b.status === 'confirmed'" class="mt-2 flex gap-2">
        <button data-testid="mark-completed" type="button" class="rounded-lg border px-3 py-1 text-sm" @click="markStatus(b.id, 'completed')">
          انجام شد
        </button>
        <button data-testid="mark-no-show" type="button" class="rounded-lg border px-3 py-1 text-sm" @click="markStatus(b.id, 'no_show')">
          عدم حضور
        </button>
        <button
          data-testid="cancel-booking"
          type="button"
          class="rounded-lg border px-3 py-1 text-sm text-red-600"
          @click="cancelBooking(b.id)"
        >
          لغو
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (2 tests in this file)

- [ ] **Step 5: Commit**

```bash
git add apps/provider-panel/src/pages/BookingsView.vue apps/provider-panel/src/pages/BookingsView.spec.ts
git commit -m "feat(provider-panel): add bookings view with status actions and cancel"
```

---

### Task 20: `ServicesView` (CRUD + active toggle)

**Files:**
- Create: `apps/provider-panel/src/pages/ServicesView.vue`

No dedicated spec test — plain CRUD over `/salons/mine/services`, same reasoning as Task 18.

- [ ] **Step 1: Write the component**

```vue
<!-- apps/provider-panel/src/pages/ServicesView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface Service {
  id: string
  categoryId: number
  name: string
  price: number
  durationMin: number
  isActive: boolean
}

const { apiFetch } = useApi()
const services = ref<Service[]>([])
const categories = ref<{ id: number; name: string }[]>([])
const newService = reactive({ categoryId: null as number | null, name: '', price: 0, durationMin: 30 })

async function load() {
  const { data } = await apiFetch<Service[]>('/salons/mine/services', { silent: true })
  services.value = data ?? []
}

onMounted(async () => {
  const [categoriesRes] = await Promise.all([apiFetch<{ id: number; name: string }[]>('/categories', { silent: true }), load()])
  categories.value = categoriesRes.data ?? []
})

async function addService() {
  if (!newService.categoryId || newService.name.trim().length < 2) return
  await apiFetch('/salons/mine/services', { method: 'POST', body: { ...newService } })
  newService.categoryId = null
  newService.name = ''
  newService.price = 0
  newService.durationMin = 30
  await load()
}

async function toggleActive(service: Service) {
  if (service.isActive) {
    await apiFetch(`/salons/mine/services/${service.id}`, { method: 'DELETE' })
  } else {
    await apiFetch(`/salons/mine/services/${service.id}`, { method: 'PATCH', body: { isActive: true } })
  }
  await load()
}

async function updatePrice(service: Service, price: number) {
  await apiFetch(`/salons/mine/services/${service.id}`, { method: 'PATCH', body: { price } })
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold">خدمات و قیمت‌ها</h1>

    <div v-for="s in services" :key="s.id" class="flex items-center justify-between rounded-lg border p-3">
      <div>
        <p class="font-bold">{{ s.name }}</p>
        <input
          :value="s.price"
          type="number"
          class="w-28 rounded border p-1 text-sm"
          @change="updatePrice(s, +($event.target as HTMLInputElement).value)"
        />
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" :checked="s.isActive" @change="toggleActive(s)" />
        فعال
      </label>
    </div>

    <div class="space-y-2 rounded-lg border p-3">
      <h2 class="font-bold">افزودن خدمت جدید</h2>
      <select v-model.number="newService.categoryId" class="w-full rounded-lg border p-2">
        <option :value="null" disabled>دسته‌بندی</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <input v-model="newService.name" placeholder="نام خدمت" class="w-full rounded-lg border p-2" />
      <input v-model.number="newService.price" type="number" placeholder="قیمت" class="w-full rounded-lg border p-2" />
      <input v-model.number="newService.durationMin" type="number" placeholder="مدت زمان (دقیقه)" class="w-full rounded-lg border p-2" />
      <button type="button" class="w-full rounded-lg bg-(--color-accent) p-2 text-white" @click="addService">افزودن</button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add apps/provider-panel/src/pages/ServicesView.vue
git commit -m "feat(provider-panel): add services CRUD view"
```

---

### Task 21: `HoursView` (weekly template + exceptions)

**Files:**
- Create: `apps/provider-panel/src/pages/HoursView.vue`

Reuses `ScheduleStep.vue` from Task 14 for the weekly-template editor UI, plus a simple exception-date list.

- [ ] **Step 1: Write the component**

```vue
<!-- apps/provider-panel/src/pages/HoursView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import ScheduleStep from '@/components/onboarding/ScheduleStep.vue'
import { useApi } from '@/composables/useApi'

interface WorkingHour {
  weekday: number
  openTime: string
  closeTime: string
}
interface ScheduleException {
  id: string
  date: string
  isClosed: boolean
}

const { apiFetch } = useApi()
const hours = ref(
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, openTime: '09:00', closeTime: '20:00', enabled: false })),
)
const exceptions = ref<ScheduleException[]>([])
const newExceptionDate = ref('')

async function loadHours() {
  const { data } = await apiFetch<WorkingHour[]>('/salons/mine/hours', { silent: true })
  if (!data) return
  for (const day of hours.value) {
    const match = data.find((h) => h.weekday === day.weekday)
    if (match) Object.assign(day, { ...match, enabled: true })
  }
}

async function loadExceptions() {
  const { data } = await apiFetch<ScheduleException[]>('/salons/mine/exceptions', { silent: true })
  exceptions.value = data ?? []
}

onMounted(() => {
  loadHours()
  loadExceptions()
})

async function saveHours() {
  const enabled = hours.value
    .filter((h) => h.enabled)
    .map(({ weekday, openTime, closeTime }) => ({ weekday, openTime, closeTime }))
  await apiFetch('/salons/mine/hours', { method: 'PUT', body: { hours: enabled } })
}

async function addException() {
  if (!newExceptionDate.value) return
  await apiFetch('/salons/mine/exceptions', { method: 'POST', body: { date: newExceptionDate.value, isClosed: true } })
  newExceptionDate.value = ''
  await loadExceptions()
}

async function removeException(id: string) {
  await apiFetch(`/salons/mine/exceptions/${id}`, { method: 'DELETE' })
  await loadExceptions()
}
</script>

<template>
  <div class="space-y-6 p-4">
    <section>
      <h1 class="mb-2 text-lg font-bold">ساعات کاری هفتگی</h1>
      <ScheduleStep v-model="hours" />
      <button type="button" class="mt-3 rounded-lg bg-(--color-accent) px-4 py-2 text-white" @click="saveHours">
        ذخیره ساعات کاری
      </button>
    </section>

    <section>
      <h2 class="mb-2 font-bold">تعطیلی‌های موردی</h2>
      <div class="flex gap-2">
        <input v-model="newExceptionDate" type="date" class="flex-1 rounded-lg border p-2" />
        <button type="button" class="rounded-lg border px-3" @click="addException">افزودن</button>
      </div>
      <ul class="mt-2 space-y-1">
        <li v-for="e in exceptions" :key="e.id" class="flex items-center justify-between rounded border p-2 text-sm">
          {{ e.date }}
          <button type="button" class="text-red-600" @click="removeException(e.id)">حذف</button>
        </li>
      </ul>
    </section>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add apps/provider-panel/src/pages/HoursView.vue
git commit -m "feat(provider-panel): add hours and exceptions view"
```

---

### Task 22: `PhotosView` (upload, delete, reorder, set cover)

**Files:**
- Create: `apps/provider-panel/src/components/photos/PhotoUploader.vue`
- Test: `apps/provider-panel/src/components/photos/PhotoUploader.spec.ts`
- Create: `apps/provider-panel/src/pages/PhotosView.vue`

`PhotoUploader` is the other component the design doc's Testing section calls out explicitly.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/provider-panel/src/components/photos/PhotoUploader.spec.ts
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PhotoUploader from './PhotoUploader.vue'

describe('PhotoUploader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads a selected image file and emits uploaded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'p1', url: 'http://localhost:3002/uploads/x.jpg', isCover: true, sortOrder: 0 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PhotoUploader)
    const file = new File(['bytes'], 'a.jpg', { type: 'image/jpeg' })
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[0]![0]).toContain('/salons/mine/photos')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' })
    expect(wrapper.emitted('uploaded')?.[0]).toEqual([{ id: 'p1', url: 'http://localhost:3002/uploads/x.jpg', isCover: true, sortOrder: 0 }])
  })

  it('rejects a non-image file client-side without calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PhotoUploader)
    const file = new File(['bytes'], 'a.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('تصویر')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: FAIL with "Cannot find module './PhotoUploader.vue'"

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- apps/provider-panel/src/components/photos/PhotoUploader.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface SalonPhoto {
  id: string
  url: string
  isCover: boolean
  sortOrder: number
}

const emit = defineEmits<{ uploaded: [photo: SalonPhoto] }>()
const { apiFetch } = useApi()
const error = ref('')

async function onFileChange(event: Event) {
  error.value = ''
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    error.value = 'فقط تصویر (jpeg, png, webp) مجاز است.'
    return
  }

  const form = new FormData()
  form.append('file', file)
  const { data, error: apiError } = await apiFetch<SalonPhoto>('/salons/mine/photos', { method: 'POST', body: form })
  if (apiError || !data) {
    error.value = 'بارگذاری تصویر ناموفق بود.'
    return
  }
  emit('uploaded', data)
}
</script>

<template>
  <div>
    <input type="file" accept="image/jpeg,image/png,image/webp" @change="onFileChange" />
    <p v-if="error" class="mt-1 text-sm text-red-600">{{ error }}</p>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arayeshgah/provider-panel test`
Expected: PASS (2 tests in this file)

- [ ] **Step 5: Write `PhotosView.vue`**

```vue
<!-- apps/provider-panel/src/pages/PhotosView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PhotoUploader from '@/components/photos/PhotoUploader.vue'
import { useApi } from '@/composables/useApi'

interface SalonPhoto {
  id: string
  url: string
  isCover: boolean
  sortOrder: number
}

const { apiFetch } = useApi()
const photos = ref<SalonPhoto[]>([])

async function load() {
  const { data } = await apiFetch<SalonPhoto[]>('/salons/mine/photos', { silent: true })
  photos.value = data ?? []
}

onMounted(load)

function onUploaded(photo: SalonPhoto) {
  photos.value.push(photo)
}

async function setCover(id: string) {
  await apiFetch(`/salons/mine/photos/${id}`, { method: 'PATCH', body: { isCover: true } })
  await load()
}

async function removePhoto(id: string) {
  await apiFetch(`/salons/mine/photos/${id}`, { method: 'DELETE' })
  await load()
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold">تصاویر آرایشگاه</h1>
    <PhotoUploader @uploaded="onUploaded" />

    <div class="grid grid-cols-2 gap-3">
      <div v-for="p in photos" :key="p.id" class="space-y-1">
        <img :src="p.url" class="aspect-square w-full rounded-lg object-cover" />
        <div class="flex justify-between text-xs">
          <button type="button" :disabled="p.isCover" @click="setCover(p.id)">
            {{ p.isCover ? 'عکس اصلی' : 'انتخاب به‌عنوان اصلی' }}
          </button>
          <button type="button" class="text-red-600" @click="removePhoto(p.id)">حذف</button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 6: Commit**

```bash
git add apps/provider-panel/src/components/photos apps/provider-panel/src/pages/PhotosView.vue
git commit -m "feat(provider-panel): add photo upload, gallery, and cover selection"
```

---

### Task 23: `ReviewsView` (read + reply)

**Files:**
- Create: `apps/provider-panel/src/pages/ReviewsView.vue`

Reads from the existing public `GET /salons/:salonId/reviews` (the salon already knows its own id from `useSalon()`), replies via the existing `PATCH /salons/mine/reviews/:id/reply`.

- [ ] **Step 1: Write the component**

```vue
<!-- apps/provider-panel/src/pages/ReviewsView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useSalon } from '@/composables/useSalon'

interface Review {
  id: string
  rating: number
  comment: string | null
  salonReply: string | null
  createdAt: string
}

const { apiFetch } = useApi()
const { salon } = useSalon()
const reviews = ref<Review[]>([])
const drafts = reactive<Record<string, string>>({})

onMounted(async () => {
  if (!salon.value) return
  const { data } = await apiFetch<Review[]>(`/salons/${salon.value.id}/reviews`, { silent: true })
  reviews.value = data ?? []
  for (const r of reviews.value) drafts[r.id] = r.salonReply ?? ''
})

async function sendReply(id: string) {
  const reply = drafts[id]?.trim()
  if (!reply) return
  const { data } = await apiFetch<Review>(`/salons/mine/reviews/${id}/reply`, { method: 'PATCH', body: { reply } })
  if (data) {
    const target = reviews.value.find((r) => r.id === id)
    if (target) target.salonReply = data.salonReply
  }
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold">نظرات مشتریان</h1>
    <div v-for="r in reviews" :key="r.id" class="space-y-2 rounded-lg border p-3">
      <p>{{ '⭐'.repeat(r.rating) }}</p>
      <p v-if="r.comment">{{ r.comment }}</p>
      <p v-if="r.salonReply" class="rounded bg-(--color-surface) p-2 text-sm">پاسخ شما: {{ r.salonReply }}</p>
      <div class="flex gap-2">
        <input v-model="drafts[r.id]" placeholder="پاسخ شما" class="flex-1 rounded-lg border p-2 text-sm" />
        <button type="button" class="rounded-lg border px-3 text-sm" @click="sendReply(r.id)">ارسال</button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add apps/provider-panel/src/pages/ReviewsView.vue
git commit -m "feat(provider-panel): add reviews view with reply"
```

---

### Task 24: `EarningsView`

**Files:**
- Create: `apps/provider-panel/src/pages/EarningsView.vue`

Reads the Task 5 `GET /salons/mine/earnings` endpoint. Kept intentionally simple for v1 per the design doc — a summary only, no per-booking breakdown table (the Bookings view already covers that granularity).

- [ ] **Step 1: Write the component**

```vue
<!-- apps/provider-panel/src/pages/EarningsView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface Earnings {
  totalCollected: number
  commissionPercent: number
  commissionAmount: number
  netPayout: number
}

const { apiFetch } = useApi()
const earnings = ref<Earnings | null>(null)

onMounted(async () => {
  const { data } = await apiFetch<Earnings>('/salons/mine/earnings', { silent: true })
  earnings.value = data
})

function toman(amount: number): string {
  return `${amount.toLocaleString('fa-IR')} تومان`
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold">درآمد</h1>
    <div v-if="earnings" class="space-y-3">
      <div class="rounded-lg border p-4">
        <p class="text-sm text-gray-500">مجموع دریافتی</p>
        <p class="text-xl font-bold">{{ toman(earnings.totalCollected) }}</p>
      </div>
      <div class="rounded-lg border p-4">
        <p class="text-sm text-gray-500">کارمزد پلتفرم ({{ earnings.commissionPercent }}٪)</p>
        <p class="text-xl font-bold">{{ toman(earnings.commissionAmount) }}</p>
      </div>
      <div class="rounded-lg border p-4">
        <p class="text-sm text-gray-500">مبلغ قابل پرداخت</p>
        <p class="text-xl font-bold">{{ toman(earnings.netPayout) }}</p>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add apps/provider-panel/src/pages/EarningsView.vue
git commit -m "feat(provider-panel): add earnings summary view"
```

---

### Task 25: Playwright e2e setup and global fixture data

**Files:**
- Create: `apps/provider-panel/playwright.config.ts`
- Create: `apps/provider-panel/e2e/global-setup.ts`

Mirrors user-app's Playwright setup exactly (schema reset, migration run, Redis flush for OTP rate limits) plus seeds one already-approved provider with a confirmed, paid booking so the bookings-status e2e test doesn't have to drive the full customer booking+payment flow first.

- [ ] **Step 1: Write `playwright.config.ts`**

```typescript
// apps/provider-panel/playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: { baseURL: 'http://localhost:3004' },
  webServer: [
    {
      command: 'pnpm --filter @arayeshgah/api dev',
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @arayeshgah/provider-panel dev',
      url: 'http://localhost:3004',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
```

- [ ] **Step 2: Write `e2e/global-setup.ts`**

```typescript
// apps/provider-panel/e2e/global-setup.ts
import { Client } from 'pg'
import { execSync } from 'node:child_process'
import path from 'node:path'
import Redis from 'ioredis'

function makeClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'arayeshgah',
    password: process.env.DB_PASS ?? 'arayeshgah',
    database: process.env.DB_NAME ?? 'arayeshgah',
  })
}

export default async function globalSetup() {
  const client = makeClient()
  await client.connect()
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await client.end()

  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })
  await redis.flushdb()
  await redis.quit()

  execSync('pnpm --filter @arayeshgah/api migration:run', {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'inherit',
  })

  const seed = makeClient()
  await seed.connect()
  const { rows: [{ id: ownerId }] } = await seed.query(
    `INSERT INTO users (phone, role) VALUES ('09120000300', 'provider') RETURNING id`,
  )
  const { rows: [{ id: salonId }] } = await seed.query(
    `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
     VALUES ($1, 'سالن تست پنل', 'e2e-provider-panel-salon', 'women', 'approved', 'آدرس تست', 'تهران',
       ST_SetSRID(ST_MakePoint(51.389, 35.6892), 4326)::geography)
     RETURNING id`,
    [ownerId],
  )
  const { rows: [{ id: categoryId }] } = await seed.query(`SELECT id FROM service_categories LIMIT 1`)
  const { rows: [{ id: serviceId }] } = await seed.query(
    `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min, is_active)
     VALUES ($1, $2, 'کوتاهی مو', 300000, 30, true) RETURNING id`,
    [salonId, categoryId],
  )
  const { rows: [{ id: customerId }] } = await seed.query(
    `INSERT INTO users (phone, role) VALUES ('09120000301', 'customer') RETURNING id`,
  )
  const { rows: [{ id: bookingId }] } = await seed.query(
    `INSERT INTO bookings (user_id, salon_id, service_id, starts_at, ends_at, price_snapshot, deposit_amount, status)
     VALUES ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 30 minutes', 300000, 60000, 'confirmed')
     RETURNING id`,
    [customerId, salonId, serviceId],
  )
  await seed.query(
    `INSERT INTO payments (booking_id, amount, gateway, status) VALUES ($1, 60000, 'zarinpal', 'paid')`,
    [bookingId],
  )
  await seed.end()
}
```

- [ ] **Step 3: Add the `pg` dependency (already present transitively via user-app, but this app needs its own)**

Run: `pnpm --filter @arayeshgah/provider-panel add -D pg @types/pg`

- [ ] **Step 4: Commit**

```bash
git add apps/provider-panel/playwright.config.ts apps/provider-panel/e2e/global-setup.ts apps/provider-panel/package.json pnpm-lock.yaml
git commit -m "test(provider-panel): add Playwright e2e setup and fixture seeding"
```

---

### Task 26: E2E — onboarding happy path

**Files:**
- Create: `apps/provider-panel/e2e/01-onboarding.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/provider-panel/e2e/01-onboarding.spec.ts
import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

test('login, complete onboarding wizard, land on pending-approval', async ({ page }) => {
  const phone = '09120000400'
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('phone-input').fill(phone)
  await page.getByTestId('phone-form').getByRole('button').click()

  const codeInput = page.getByTestId('code-input')
  await expect(codeInput).toBeVisible()
  const code = await redis.get(`otp:${phone}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis -- did SMS_PROVIDER/OtpService change?')
  await codeInput.fill(code)
  await page.getByTestId('code-form').getByRole('button').click()

  await expect(page).toHaveURL('/onboarding')

  await page.getByTestId('salon-name').fill('سالن پلی‌رایت')
  await page.getByTestId('gender-target').selectOption('women')
  await page.getByTestId('city').fill('تهران')
  await page.getByTestId('address').fill('خیابان آزادی، پلاک ۲')
  // Whether the real Neshan SDK loads in this environment or not, SalonPinPicker emits a
  // default coordinate either way (see its onMounted success path and its catch-block
  // fallback) -- waiting for the next button to enable covers both cases without the test
  // needing to know which one happened.
  await expect(page.getByTestId('wizard-next')).toBeEnabled({ timeout: 15_000 })
  await page.getByTestId('wizard-next').click()

  await page.locator('[data-testid="day-0"] input[type=checkbox]').check()
  await page.getByTestId('wizard-next').click()

  await page.getByTestId('service-category').selectOption({ index: 1 })
  await page.getByTestId('service-name').fill('کوتاهی مو')
  await page.getByTestId('service-price').fill('250000')
  await page.getByTestId('service-duration').fill('45')
  await page.getByTestId('wizard-submit').click()

  await expect(page).toHaveURL('/pending-approval')
  await expect(page.getByText('در حال بررسی است')).toBeVisible()
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @arayeshgah/provider-panel test:e2e`
Expected: PASS (1 test)

- [ ] **Step 3: Commit**

```bash
git add apps/provider-panel/e2e/01-onboarding.spec.ts
git commit -m "test(provider-panel): add onboarding happy-path e2e coverage"
```

---

### Task 27: E2E — bookings status update, and final root wiring

**Files:**
- Create: `apps/provider-panel/e2e/02-bookings-status.spec.ts`
- Modify: `docs/superpowers/plans/2026-07-07-plan-5-provider-panel.md` (mark complete — no action needed, this is the last task)

- [ ] **Step 1: Write the test**

```typescript
// apps/provider-panel/e2e/02-bookings-status.spec.ts
import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

test('log in as an approved provider and mark a confirmed booking completed', async ({ page }) => {
  const phone = '09120000300' // seeded in global-setup.ts with an approved salon + confirmed booking
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('phone-input').fill(phone)
  await page.getByTestId('phone-form').getByRole('button').click()

  const codeInput = page.getByTestId('code-input')
  await expect(codeInput).toBeVisible()
  const code = await redis.get(`otp:${phone}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis -- did SMS_PROVIDER/OtpService change?')
  await codeInput.fill(code)
  await page.getByTestId('code-form').getByRole('button').click()

  await expect(page).toHaveURL('/')

  await page.getByRole('link', { name: 'نوبت‌ها' }).click()
  await expect(page).toHaveURL('/bookings')

  await page.getByTestId('mark-completed').first().click()
  await expect(page.getByText('completed')).toBeVisible()
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @arayeshgah/provider-panel test:e2e`
Expected: PASS (2 tests total)

- [ ] **Step 3: Run the full test suite one more time (unit + component + e2e) before wrapping up**

Run: `pnpm --filter @arayeshgah/provider-panel test && pnpm --filter @arayeshgah/provider-panel test:e2e`
Expected: all green

- [ ] **Step 4: Run the backend's full suite too, to confirm none of Tasks 1-6 broke existing behavior**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e`
Expected: all green (pre-existing suites plus the new ones from Tasks 1-6)

- [ ] **Step 5: Commit**

```bash
git add apps/provider-panel/e2e/02-bookings-status.spec.ts
git commit -m "test(provider-panel): add bookings status-update e2e coverage"
```

---

## Summary

25 backend/frontend implementation tasks (Tasks 1-6 backend, Tasks 7-27 frontend) take the Provider Panel from "doesn't exist" to a working Vue 3 SPA covering onboarding, dashboard, bookings, services, hours, photos, reviews, and earnings — reusing nearly all of the existing `/salons/mine/*` API surface and adding only the two things that didn't already exist: photo storage and an earnings aggregation endpoint.

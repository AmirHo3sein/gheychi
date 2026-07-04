# Plan 1: Foundation & Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Arayeshgah monorepo and a working NestJS API with phone-OTP auth, salon/catalog management, and PostGIS geo-search — everything the booking engine (Plan 2) builds on.

**Architecture:** pnpm + Turborepo monorepo; single NestJS modular-monolith API (`apps/api`); PostgreSQL 16 + PostGIS via TypeORM (raw-SQL migrations, no `synchronize`); Redis for OTP + rate limiting; auth via JWT in an HttpOnly `session` cookie. External providers (SMS) sit behind interfaces with a console implementation for dev/test.

**Tech Stack:** Node 22, pnpm 9, Turborepo 2, NestJS 11, TypeORM 0.3, pg, ioredis, @nestjs/jwt, class-validator, Jest + ts-jest + supertest, Docker Compose (postgis/postgis:16-3.4, redis:7-alpine).

**Spec:** `docs/superpowers/specs/2026-07-04-arayeshgah-marketplace-design.md`

**Scope notes (deliberate, from the spec):**
- Bookings, payments, reviews tables/modules → Plan 2. Admin endpoints (approval) → Plan 5; tests here set salon status via direct DB update.
- Photo upload endpoints (ArvanCloud) → Plan 4; the `salon_photos` table is created now so the schema is complete.
- One salon per owner is enforced in MVP (unique index on `salons.owner_id`).
- `/api/search` requires a `gender` query param in this plan; the user-app will pass the profile's gender (optional-auth resolution can be added later without breaking this contract).
- Service "delete" archives (`is_active = false`) — Plan 2's bookings will reference services, so hard deletes are never introduced.

**Working directory:** all paths relative to repo root `C:\Users\amirh\Desktop\Projects\Arayeshgah`.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "arayeshgah",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev:api": "turbo run dev --filter=@arayeshgah/api",
    "build": "turbo run build",
    "test": "turbo run test",
    "test:e2e": "turbo run test:e2e"
  },
  "devDependencies": {
    "turbo": "^2.5.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "test:e2e": {
      "cache": false
    }
  }
}
```

- [ ] **Step 4: Install and verify**

Run: `pnpm install`
Expected: lockfile created, `turbo` installed, no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml
git commit -m "chore: scaffold pnpm + turborepo monorepo"
```

---

### Task 2: Docker dev infrastructure & env files

**Files:**
- Create: `docker-compose.yml`
- Create: `docker/postgres-init/01-test-db.sql`
- Create: `.env.example`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: arayeshgah
      POSTGRES_PASSWORD: arayeshgah
      POSTGRES_DB: arayeshgah
    ports:
      - "5432:5432"
    volumes:
      - ./docker/postgres-init:/docker-entrypoint-initdb.d
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

- [ ] **Step 2: Create `docker/postgres-init/01-test-db.sql`**

```sql
CREATE DATABASE arayeshgah_test;
```

- [ ] **Step 3: Create `.env.example`**

```
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USER=arayeshgah
DB_PASS=arayeshgah
DB_NAME=arayeshgah
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=dev-secret-change-me
SMS_PROVIDER=console
KAVENEGAR_API_KEY=
KAVENEGAR_OTP_TEMPLATE=arayeshgah-otp
```

- [ ] **Step 4: Start containers and verify**

Run: `docker compose up -d && docker compose ps`
Expected: `postgres` and `redis` both `running`. Then verify PostGIS and the test DB:

Run: `docker compose exec postgres psql -U arayeshgah -c "SELECT postgis_version();" && docker compose exec postgres psql -U arayeshgah -lqt`
Expected: a PostGIS version row; database list includes `arayeshgah` and `arayeshgah_test`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docker/postgres-init/01-test-db.sql .env.example
git commit -m "chore: add docker compose for postgis + redis with test database"
```

---

### Task 3: NestJS API scaffold with health endpoint

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/.env` (copy of `.env.example`)
- Create: `apps/api/.env.test`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/test/jest-e2e.json`
- Create: `apps/api/test/utils/test-app.ts`
- Test: `apps/api/test/health.e2e-spec.ts`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@arayeshgah/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "test": "jest",
    "test:e2e": "cross-env NODE_ENV=test jest --config ./test/jest-e2e.json --runInBand",
    "migration:run": "typeorm-ts-node-commonjs migration:run -d src/data-source.ts",
    "migration:revert": "typeorm-ts-node-commonjs migration:revert -d src/data-source.ts"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/jwt": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/typeorm": "^11.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "cookie-parser": "^1.4.7",
    "dotenv": "^16.4.5",
    "ioredis": "^5.6.0",
    "pg": "^8.13.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "typeorm": "^0.3.25"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.0",
    "@types/supertest": "^6.0.2",
    "cross-env": "^7.0.3",
    "ioredis-mock": "^8.9.0",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.0"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "rootDir": "src",
    "testRegex": ".spec.ts$"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create `apps/api/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 4: Create env files**

`apps/api/.env` — copy the values from `.env.example` verbatim (this file is gitignored).

`apps/api/.env.test` (committed — contains no secrets):

```
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_USER=arayeshgah
DB_PASS=arayeshgah
DB_NAME=arayeshgah_test
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=test-secret
SMS_PROVIDER=console
KAVENEGAR_API_KEY=
KAVENEGAR_OTP_TEMPLATE=arayeshgah-otp
```

Also append to root `.gitignore` (the `!` line must come after `.env.*`):

```
!.env.test
```

- [ ] **Step 5: Create `apps/api/src/main.ts`**

```typescript
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 6: Create `apps/api/src/app.module.ts`** (DB wiring comes in Task 4)

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 7: Create `apps/api/src/health/health.controller.ts`**

```typescript
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 8: Create `apps/api/test/jest-e2e.json`**

```json
{
  "preset": "ts-jest",
  "testEnvironment": "node",
  "rootDir": "..",
  "roots": ["<rootDir>/test"],
  "testRegex": ".e2e-spec.ts$",
  "moduleFileExtensions": ["js", "json", "ts"],
  "testTimeout": 30000
}
```

- [ ] **Step 9: Create `apps/api/test/utils/test-app.ts`**

```typescript
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}
```

- [ ] **Step 10: Write the failing e2e test** — `apps/api/test/health.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns ok', () =>
    request(app.getHttpServer()).get('/api/health').expect(200).expect({ status: 'ok' }));
});
```

- [ ] **Step 11: Install and run the test**

Run: `pnpm install` (from repo root)
Run: `pnpm --filter @arayeshgah/api test:e2e`
Expected: PASS (1 test). If it fails on module resolution, fix before proceeding — this helper is the foundation of every later test.

- [ ] **Step 12: Verify dev server boots**

Run: `pnpm --filter @arayeshgah/api dev` (then Ctrl+C after it prints the Nest startup log)
Expected: `Nest application successfully started`.

- [ ] **Step 13: Commit**

```bash
git add apps/api pnpm-lock.yaml .gitignore
git commit -m "feat(api): scaffold NestJS app with health endpoint and e2e test harness"
```

---

### Task 4: TypeORM wiring, migration infra, and the initial schema

**Files:**
- Create: `apps/api/src/data-source.ts`
- Create: `apps/api/src/migrations/1751600000000-initial-schema.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create `apps/api/src/data-source.ts`** (used by TypeORM CLI and test reset)

```typescript
import 'dotenv/config';
import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: +(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'arayeshgah',
  password: process.env.DB_PASS ?? 'arayeshgah',
  database: process.env.DB_NAME ?? 'arayeshgah',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});
```

- [ ] **Step 2: Add TypeORM to `apps/api/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: +config.get('DB_PORT', 5432),
        username: config.get('DB_USER'),
        password: config.get('DB_PASS'),
        database: config.get('DB_NAME'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 3: Create the initial schema migration** — `apps/api/src/migrations/1751600000000-initial-schema.ts`

All Plan-1 tables, indexes, and seed rows in one migration. Bookings/payments/reviews arrive in Plan 2's migration.

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1751600000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS postgis`);

    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        phone varchar(15) NOT NULL UNIQUE,
        name varchar(100),
        gender varchar(10),
        role varchar(10) NOT NULL DEFAULT 'customer',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE salons (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES users(id),
        name varchar(150) NOT NULL,
        slug varchar(180) NOT NULL UNIQUE,
        description text,
        gender_target varchar(10) NOT NULL,
        status varchar(12) NOT NULL DEFAULT 'pending',
        address text NOT NULL,
        city varchar(80) NOT NULL,
        location geography(Point,4326) NOT NULL,
        capacity int NOT NULL DEFAULT 1,
        rating_avg numeric(3,2) NOT NULL DEFAULT 0,
        rating_count int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX salons_owner_uidx ON salons(owner_id)`);
    await q.query(`CREATE INDEX salons_location_gist ON salons USING GIST(location)`);
    await q.query(`CREATE INDEX salons_status_gender_idx ON salons(status, gender_target)`);

    await q.query(`
      CREATE TABLE service_categories (
        id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name varchar(60) NOT NULL UNIQUE,
        icon varchar(40) NOT NULL
      )`);

    await q.query(`
      CREATE TABLE salon_services (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        category_id int NOT NULL REFERENCES service_categories(id),
        name varchar(150) NOT NULL,
        description text,
        price bigint NOT NULL,
        duration_min int NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX salon_services_salon_idx ON salon_services(salon_id)`);

    await q.query(`
      CREATE TABLE salon_photos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        url text NOT NULL,
        sort_order int NOT NULL DEFAULT 0,
        is_cover boolean NOT NULL DEFAULT false
      )`);

    await q.query(`
      CREATE TABLE working_hours (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        open_time time NOT NULL,
        close_time time NOT NULL,
        UNIQUE(salon_id, weekday, open_time)
      )`);

    await q.query(`
      CREATE TABLE schedule_exceptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        date date NOT NULL,
        is_closed boolean NOT NULL DEFAULT true,
        UNIQUE(salon_id, date)
      )`);

    await q.query(`
      CREATE TABLE platform_config (
        key varchar(60) PRIMARY KEY,
        value jsonb NOT NULL
      )`);

    await q.query(`
      INSERT INTO service_categories (name, icon) VALUES
        ('Haircut', 'scissors'),
        ('Hair Color', 'palette'),
        ('Hair Treatment', 'droplet'),
        ('Nails', 'nail'),
        ('Skin & Facial', 'sparkles'),
        ('Makeup', 'brush'),
        ('Eyebrows & Lashes', 'eye'),
        ('Grooming', 'razor')`);

    await q.query(`
      INSERT INTO platform_config (key, value) VALUES
        ('deposit_percent', '20'),
        ('deposit_min_toman', '200000'),
        ('cancellation_window_hours', '24'),
        ('commission_percent', '10'),
        ('booking_hold_ttl_minutes', '15')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE platform_config`);
    await q.query(`DROP TABLE schedule_exceptions`);
    await q.query(`DROP TABLE working_hours`);
    await q.query(`DROP TABLE salon_photos`);
    await q.query(`DROP TABLE salon_services`);
    await q.query(`DROP TABLE service_categories`);
    await q.query(`DROP TABLE salons`);
    await q.query(`DROP TABLE users`);
  }
}
```

- [ ] **Step 4: Run the migration against the dev DB**

Run (from `apps/api/`): `pnpm migration:run`
Expected: `InitialSchema1751600000000 has been executed successfully.`

Verify: `docker compose exec postgres psql -U arayeshgah -c "\dt"`
Expected: all 8 tables plus `migrations` and PostGIS's `spatial_ref_sys`.

- [ ] **Step 5: Create the test-reset helper** — `apps/api/test/utils/db.ts`

```typescript
import { config } from 'dotenv';
config({ path: '.env.test' });
import { DataSource } from 'typeorm';

export function testDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: +(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    migrations: ['src/migrations/*.ts'],
  });
}

export async function resetDatabase(): Promise<void> {
  const ds = testDataSource();
  await ds.initialize();
  await ds.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await ds.runMigrations();
  await ds.destroy();
}
```

- [ ] **Step 6: Prove the reset works** — temporarily add to `health.e2e-spec.ts`'s `beforeAll`: `await resetDatabase();` (import from `./utils/db`), run `pnpm --filter @arayeshgah/api test:e2e`, expect PASS. Keep the line — a DB-backed app module now needs a schema to boot against.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add typeorm wiring, initial schema migration, and test db reset"
```

---

### Task 5: Redis module

**Files:**
- Create: `apps/api/src/redis/redis.module.ts`

- [ ] **Step 1: Create `apps/api/src/redis/redis.module.ts`**

```typescript
import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get('REDIS_HOST', 'localhost'),
          port: +config.get('REDIS_PORT', 6379),
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
```

- [ ] **Step 2: Register in `app.module.ts`** — add `RedisModule` to the `imports` array:

```typescript
import { RedisModule } from './redis/redis.module';
// ...
  imports: [
    ConfigModule.forRoot({ /* unchanged */ }),
    TypeOrmModule.forRootAsync({ /* unchanged */ }),
    RedisModule,
  ],
```

- [ ] **Step 3: Verify nothing broke**

Run: `pnpm --filter @arayeshgah/api test:e2e`
Expected: PASS (health test still green — proves Redis connects and shuts down cleanly, no Jest hang).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): add global redis module with clean shutdown"
```

---

### Task 6: OTP service (TDD)

**Files:**
- Create: `apps/api/src/auth/otp.service.ts`
- Test: `apps/api/src/auth/otp.service.spec.ts`

- [ ] **Step 1: Write the failing unit tests** — `apps/api/src/auth/otp.service.spec.ts`

```typescript
import { HttpException } from '@nestjs/common';
import RedisMock from 'ioredis-mock';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  let redis: InstanceType<typeof RedisMock>;
  let service: OtpService;
  const phone = '09121234567';

  beforeEach(() => {
    redis = new RedisMock();
    service = new OtpService(redis as never);
  });

  it('issues a 6-digit code stored under otp:{phone}', async () => {
    const code = await service.issue(phone);
    expect(code).toMatch(/^\d{6}$/);
    expect(await redis.get(`otp:${phone}`)).toBe(code);
  });

  it('rejects the 4th request within the rate window', async () => {
    await service.issue(phone);
    await service.issue(phone);
    await service.issue(phone);
    await expect(service.issue(phone)).rejects.toThrow(HttpException);
  });

  it('verifies a correct code and consumes it', async () => {
    const code = await service.issue(phone);
    expect(await service.verify(phone, code)).toBe(true);
    expect(await service.verify(phone, code)).toBe(false); // consumed
  });

  it('rejects a wrong code but allows a later correct attempt', async () => {
    const code = await service.issue(phone);
    expect(await service.verify(phone, '000000')).toBe(false);
    expect(await service.verify(phone, code)).toBe(true);
  });

  it('kills the code after 5 failed attempts', async () => {
    const code = await service.issue(phone);
    for (let i = 0; i < 5; i++) await service.verify(phone, '000000');
    expect(await service.verify(phone, code)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @arayeshgah/api test -- otp.service`
Expected: FAIL — `Cannot find module './otp.service'`.

- [ ] **Step 3: Implement** — `apps/api/src/auth/otp.service.ts`

```typescript
import { HttpException, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

const OTP_TTL_SEC = 120;
const RATE_LIMIT_MAX = 3;
const RATE_WINDOW_SEC = 3600;
const MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async issue(phone: string): Promise<string> {
    const rlKey = `rl:otp:${phone}`;
    const count = await this.redis.incr(rlKey);
    if (count === 1) await this.redis.expire(rlKey, RATE_WINDOW_SEC);
    if (count > RATE_LIMIT_MAX) {
      throw new HttpException('Too many OTP requests', 429);
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`otp:${phone}`, code, 'EX', OTP_TTL_SEC);
    await this.redis.del(`otp:att:${phone}`);
    return code;
  }

  async verify(phone: string, code: string): Promise<boolean> {
    const key = `otp:${phone}`;
    const attemptsKey = `otp:att:${phone}`;
    const stored = await this.redis.get(key);
    if (!stored) return false;

    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) await this.redis.expire(attemptsKey, OTP_TTL_SEC);
    if (attempts > MAX_VERIFY_ATTEMPTS) {
      await this.redis.del(key, attemptsKey);
      return false;
    }
    if (stored !== code) return false;

    await this.redis.del(key, attemptsKey);
    return true;
  }
}
```

Note the off-by-one: the 5th failed attempt increments to 5 (allowed), so the 6th call — even with the right code — increments to 6 and deletes. The test above does 5 wrong attempts then a correct one; it must fail. If your implementation lets it pass, `MAX_VERIFY_ATTEMPTS` handling is wrong.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @arayeshgah/api test -- otp.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(api): add otp service with rate limiting and attempt caps"
```

---

### Task 7: SMS provider abstraction (console + Kavenegar)

**Files:**
- Create: `apps/api/src/sms/sms.provider.ts`
- Create: `apps/api/src/sms/console-sms.provider.ts`
- Create: `apps/api/src/sms/kavenegar-sms.provider.ts`
- Create: `apps/api/src/sms/sms.module.ts`
- Test: `apps/api/src/sms/kavenegar-sms.provider.spec.ts`

- [ ] **Step 1: Create the interface** — `apps/api/src/sms/sms.provider.ts`

```typescript
export const SMS_PROVIDER = 'SMS_PROVIDER';

export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}
```

- [ ] **Step 2: Console implementation** — `apps/api/src/sms/console-sms.provider.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');

  async sendOtp(phone: string, code: string): Promise<void> {
    this.logger.log(`OTP for ${phone}: ${code}`);
  }
}
```

- [ ] **Step 3: Write the failing Kavenegar test** — `apps/api/src/sms/kavenegar-sms.provider.spec.ts`

```typescript
import { KavenegarSmsProvider } from './kavenegar-sms.provider';

describe('KavenegarSmsProvider', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('calls the verify/lookup endpoint with phone, code, and template', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ return: { status: 200 } }),
    });
    const provider = new KavenegarSmsProvider('MY_KEY', 'my-template');
    await provider.sendOtp('09121234567', '123456');

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('/v1/MY_KEY/verify/lookup.json');
    expect(url).toContain('receptor=09121234567');
    expect(url).toContain('token=123456');
    expect(url).toContain('template=my-template');
  });

  it('throws when kavenegar reports failure', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ return: { status: 418, message: 'invalid' } }),
    });
    const provider = new KavenegarSmsProvider('MY_KEY', 'my-template');
    await expect(provider.sendOtp('09121234567', '123456')).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @arayeshgah/api test -- kavenegar`
Expected: FAIL — `Cannot find module './kavenegar-sms.provider'`.

- [ ] **Step 5: Implement** — `apps/api/src/sms/kavenegar-sms.provider.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

@Injectable()
export class KavenegarSmsProvider implements SmsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly otpTemplate: string,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const params = new URLSearchParams({
      receptor: phone,
      token: code,
      template: this.otpTemplate,
    });
    const url = `https://api.kavenegar.com/v1/${this.apiKey}/verify/lookup.json?${params}`;
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok || body?.return?.status !== 200) {
      throw new Error(`Kavenegar send failed: ${body?.return?.message ?? res.status}`);
    }
  }
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter @arayeshgah/api test -- kavenegar`
Expected: PASS (2 tests).

- [ ] **Step 7: Wire the module** — `apps/api/src/sms/sms.module.ts` (config-driven selection)

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleSmsProvider } from './console-sms.provider';
import { KavenegarSmsProvider } from './kavenegar-sms.provider';
import { SMS_PROVIDER } from './sms.provider';

@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('SMS_PROVIDER') === 'kavenegar'
          ? new KavenegarSmsProvider(
              config.get('KAVENEGAR_API_KEY', ''),
              config.get('KAVENEGAR_OTP_TEMPLATE', 'arayeshgah-otp'),
            )
          : new ConsoleSmsProvider(),
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/sms
git commit -m "feat(api): add sms provider abstraction with console and kavenegar implementations"
```

---

### Task 8: Users entity + Auth module (OTP login, session cookie, guards)

**Files:**
- Create: `apps/api/src/users/user.entity.ts`
- Create: `apps/api/src/users/users.service.ts`
- Create: `apps/api/src/users/users.module.ts`
- Create: `apps/api/src/auth/dto/auth.dto.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.guard.ts`
- Create: `apps/api/src/auth/roles.decorator.ts`
- Create: `apps/api/src/auth/roles.guard.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/test/utils/auth-helper.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/auth.e2e-spec.ts`

- [ ] **Step 1: Create `apps/api/src/users/user.entity.ts`**

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type Gender = 'female' | 'male';
export type UserRole = 'customer' | 'provider' | 'admin';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  phone: string;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'varchar', nullable: true })
  gender: Gender | null;

  @Column({ type: 'varchar', default: 'customer' })
  role: UserRole;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: Create `apps/api/src/users/users.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Gender, User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  async findOrCreateByPhone(phone: string): Promise<{ user: User; isNew: boolean }> {
    const existing = await this.repo.findOneBy({ phone });
    if (existing) return { user: existing, isNew: false };
    const user = await this.repo.save(this.repo.create({ phone }));
    return { user, isNew: true };
  }

  async updateProfile(id: string, patch: { name?: string; gender?: Gender }): Promise<User> {
    await this.repo.update({ id }, patch);
    return (await this.repo.findOneBy({ id }))!;
  }

  async promoteToProvider(id: string): Promise<void> {
    await this.repo.update({ id, role: 'customer' }, { role: 'provider' });
  }
}
```

- [ ] **Step 3: Create `apps/api/src/users/users.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 4: Create DTOs** — `apps/api/src/auth/dto/auth.dto.ts`

```typescript
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

const IRAN_MOBILE = /^09\d{9}$/;

export class RequestOtpDto {
  @Matches(IRAN_MOBILE, { message: 'phone must be a valid Iranian mobile number' })
  phone: string;
}

export class VerifyOtpDto {
  @Matches(IRAN_MOBILE, { message: 'phone must be a valid Iranian mobile number' })
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsIn(['female', 'male'])
  gender?: 'female' | 'male';
}
```

- [ ] **Step 5: Create the auth guard** — `apps/api/src/auth/auth.guard.ts`

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

export const SESSION_COOKIE = 'session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync(token);
      const user = await this.users.findById(payload.sub);
      if (!user) throw new UnauthorizedException();
      req.user = user;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
```

- [ ] **Step 6: Roles decorator and guard**

`apps/api/src/auth/roles.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../users/user.entity';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

`apps/api/src/auth/roles.guard.ts` (runs after AuthGuard, reads `req.user`):

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../users/user.entity';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    if (!user || !required.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}
```

- [ ] **Step 7: Auth controller** — `apps/api/src/auth/auth.controller.ts`

```typescript
import {
  Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthGuard, SESSION_COOKIE } from './auth.guard';
import { RequestOtpDto, UpdateProfileDto, VerifyOtpDto } from './dto/auth.dto';
import { OtpService } from './otp.service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function publicUser(user: User) {
  const { id, phone, name, gender, role } = user;
  return { id, phone, name, gender, role };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  @Post('request-otp')
  async requestOtp(@Body() dto: RequestOtpDto) {
    const code = await this.otp.issue(dto.phone);
    await this.sms.sendOtp(dto.phone, code);
    return { ok: true };
  }

  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const valid = await this.otp.verify(dto.phone, dto.code);
    if (!valid) throw new UnauthorizedException('Invalid or expired code');

    const { user, isNew } = await this.users.findOrCreateByPhone(dto.phone);
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: THIRTY_DAYS_MS,
    });
    return { user: publicUser(user), isNewUser: isNew };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: Request) {
    return publicUser(req.user as User);
  }

  @Patch('profile')
  @UseGuards(AuthGuard)
  async updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const updated = await this.users.updateProfile((req.user as User).id, dto);
    return publicUser(updated);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE);
  }
}
```

- [ ] **Step 8: Auth module** — `apps/api/src/auth/auth.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
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
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [OtpService, AuthGuard, RolesGuard],
  exports: [OtpService, AuthGuard, RolesGuard, UsersModule],
})
export class AuthModule {}
```

Register in `app.module.ts` imports: add `AuthModule` after `RedisModule`.

- [ ] **Step 9: Test login helper** — `apps/api/test/utils/auth-helper.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { REDIS } from '../../src/redis/redis.module';

/** Full OTP login; returns the session cookie string for use with .set('Cookie', ...) */
export async function loginAs(app: INestApplication, phone: string): Promise<string> {
  const redis = app.get<Redis>(REDIS);
  await redis.del(`rl:otp:${phone}`);
  await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
  const code = await redis.get(`otp:${phone}`);
  const res = await request(app.getHttpServer())
    .post('/api/auth/verify-otp')
    .send({ phone, code })
    .expect(201);
  return res.get('Set-Cookie')!.find((c: string) => c.startsWith('session='))!;
}
```

- [ ] **Step 10: Write the failing e2e test** — `apps/api/test/auth.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { REDIS } from '../src/redis/redis.module';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;
  const phone = '09121234567';

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    redis = app.get<Redis>(REDIS);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an invalid phone', () =>
    request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone: '12345' }).expect(400));

  it('issues an OTP', async () => {
    await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
    expect(await redis.get(`otp:${phone}`)).toMatch(/^\d{6}$/);
  });

  it('rejects a wrong code', () =>
    request(app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ phone, code: '000000' })
      .expect(401));

  it('verifies, sets an HttpOnly session cookie, and creates the user', async () => {
    const code = await redis.get(`otp:${phone}`);
    const res = await request(app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ phone, code })
      .expect(201);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user.phone).toBe(phone);

    const cookie = res.get('Set-Cookie')!.find((c: string) => c.startsWith('session='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie!)
      .expect(200);
    expect(me.body.phone).toBe(phone);
    expect(me.body.role).toBe('customer');
  });

  it('completes the profile (name + gender)', async () => {
    await redis.del(`rl:otp:${phone}`);
    const { loginAs } = await import('./utils/auth-helper');
    const cookie = await loginAs(app, phone);
    const res = await request(app.getHttpServer())
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ name: 'Sara', gender: 'female' })
      .expect(200);
    expect(res.body.name).toBe('Sara');
    expect(res.body.gender).toBe('female');
  });

  it('rejects /me without a cookie', () =>
    request(app.getHttpServer()).get('/api/auth/me').expect(401));

  it('logout clears the cookie', async () => {
    await redis.del(`rl:otp:${phone}`);
    const { loginAs } = await import('./utils/auth-helper');
    const cookie = await loginAs(app, phone);
    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(204);
    const cleared = res.get('Set-Cookie')!.find((c: string) => c.startsWith('session='));
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
  });
});
```

- [ ] **Step 11: Run to verify failure, then wire everything, then verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e`
Expected first: FAIL (404s — module not registered). After registering `AuthModule` in `app.module.ts`: PASS (7 auth tests + health).

- [ ] **Step 12: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat(api): phone-otp auth with session cookie, guards, and e2e coverage"
```

---

### Task 9: Categories endpoint

**Files:**
- Create: `apps/api/src/catalog/service-category.entity.ts`
- Create: `apps/api/src/catalog/catalog.controller.ts`
- Create: `apps/api/src/catalog/catalog.module.ts`
- Test: `apps/api/test/catalog.e2e-spec.ts`

- [ ] **Step 1: Write the failing e2e test** — `apps/api/test/catalog.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Catalog (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/categories returns the seeded list', async () => {
    const res = await request(app.getHttpServer()).get('/api/categories').expect(200);
    expect(res.body.length).toBe(8);
    expect(res.body[0]).toEqual({ id: expect.any(Number), name: expect.any(String), icon: expect.any(String) });
    expect(res.body.map((c: { name: string }) => c.name)).toContain('Haircut');
  });
});
```

Run: `pnpm --filter @arayeshgah/api test:e2e -- catalog`
Expected: FAIL (404).

- [ ] **Step 2: Entity** — `apps/api/src/catalog/service-category.entity.ts`

```typescript
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('service_categories')
export class ServiceCategory {
  @PrimaryGeneratedColumn('identity')
  id: number;

  @Column({ unique: true })
  name: string;

  @Column()
  icon: string;
}
```

- [ ] **Step 3: Controller + module**

`apps/api/src/catalog/catalog.controller.ts`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceCategory } from './service-category.entity';

@Controller('categories')
export class CatalogController {
  constructor(
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
  ) {}

  @Get()
  list() {
    return this.categories.find({ order: { id: 'ASC' } });
  }
}
```

`apps/api/src/catalog/catalog.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogController } from './catalog.controller';
import { ServiceCategory } from './service-category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceCategory])],
  controllers: [CatalogController],
  exports: [TypeOrmModule],
})
export class CatalogModule {}
```

Register `CatalogModule` in `app.module.ts` imports.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- catalog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/catalog apps/api/src/app.module.ts apps/api/test/catalog.e2e-spec.ts
git commit -m "feat(api): public categories endpoint backed by seeded data"
```

---

### Task 10: Salons module — create, mine, update, public profile

**Files:**
- Create: `apps/api/src/salons/salon.entity.ts`
- Create: `apps/api/src/salons/dto/salon.dto.ts`
- Create: `apps/api/src/salons/slug.util.ts`
- Create: `apps/api/src/salons/salons.service.ts`
- Create: `apps/api/src/salons/salons.controller.ts`
- Create: `apps/api/src/salons/salons.module.ts`
- Test: `apps/api/src/salons/slug.util.spec.ts`
- Test: `apps/api/test/salons.e2e-spec.ts`

- [ ] **Step 1: Slug util TDD — failing test** — `apps/api/src/salons/slug.util.spec.ts`

```typescript
import { makeSlug } from './slug.util';

describe('makeSlug', () => {
  it('slugifies latin names and appends a 4-hex suffix', () => {
    const slug = makeSlug('VIP Beauty Salon');
    expect(slug).toMatch(/^vip-beauty-salon-[0-9a-f]{4}$/);
  });

  it('falls back to salon-<hex> for non-latin (Persian) names', () => {
    const slug = makeSlug('سالن رز');
    expect(slug).toMatch(/^salon-[0-9a-f]{8}$/);
  });

  it('generates unique slugs for the same name', () => {
    expect(makeSlug('Rose')).not.toBe(makeSlug('Rose'));
  });
});
```

Run: `pnpm --filter @arayeshgah/api test -- slug`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement** — `apps/api/src/salons/slug.util.ts`

```typescript
import { randomBytes } from 'crypto';

export function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length < 3) return `salon-${randomBytes(4).toString('hex')}`;
  return `${base}-${randomBytes(2).toString('hex')}`;
}
```

Run: `pnpm --filter @arayeshgah/api test -- slug` → PASS (3 tests).

- [ ] **Step 3: Entity** — `apps/api/src/salons/salon.entity.ts`

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type GenderTarget = 'women' | 'men';
export type SalonStatus = 'pending' | 'approved' | 'suspended';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

@Entity('salons')
export class Salon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id' })
  ownerId: string;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'gender_target', type: 'varchar' })
  genderTarget: GenderTarget;

  @Column({ type: 'varchar', default: 'pending' })
  status: SalonStatus;

  @Column({ type: 'text' })
  address: string;

  @Column()
  city: string;

  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location: GeoPoint;

  @Column({ type: 'int', default: 1 })
  capacity: number;

  @Column({ name: 'rating_avg', type: 'numeric', precision: 3, scale: 2, default: 0 })
  ratingAvg: string;

  @Column({ name: 'rating_count', type: 'int', default: 0 })
  ratingCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 4: DTOs** — `apps/api/src/salons/dto/salon.dto.ts`

```typescript
import { Type } from 'class-transformer';
import {
  IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Length, Max, Min,
} from 'class-validator';

export class CreateSalonDto {
  @IsString()
  @Length(2, 150)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(['women', 'men'])
  genderTarget: 'women' | 'men';

  @IsString()
  @Length(5, 500)
  address: string;

  @IsString()
  @Length(2, 80)
  city: string;

  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;
}

export class UpdateSalonDto {
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @Length(5, 500) address?: string;
  @IsOptional() @IsString() @Length(2, 80) city?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) capacity?: number;
}
```

- [ ] **Step 5: Service** — `apps/api/src/salons/salons.service.ts`

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { CreateSalonDto, UpdateSalonDto } from './dto/salon.dto';
import { Salon } from './salon.entity';
import { makeSlug } from './slug.util';

@Injectable()
export class SalonsService {
  constructor(
    @InjectRepository(Salon) private readonly repo: Repository<Salon>,
    private readonly users: UsersService,
  ) {}

  async createForOwner(ownerId: string, dto: CreateSalonDto): Promise<Salon> {
    const existing = await this.repo.findOneBy({ ownerId });
    if (existing) throw new ConflictException('You already have a salon');

    const salon = await this.repo.save(
      this.repo.create({
        ownerId,
        name: dto.name,
        slug: makeSlug(dto.name),
        description: dto.description ?? null,
        genderTarget: dto.genderTarget,
        address: dto.address,
        city: dto.city,
        capacity: dto.capacity ?? 1,
        location: { type: 'Point', coordinates: [dto.lng, dto.lat] },
      }),
    );
    await this.users.promoteToProvider(ownerId);
    return salon;
  }

  async findMine(ownerId: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ ownerId });
    if (!salon) throw new NotFoundException('No salon for this account');
    return salon;
  }

  async updateMine(ownerId: string, dto: UpdateSalonDto): Promise<Salon> {
    const salon = await this.findMine(ownerId);
    const { lat, lng, ...rest } = dto;
    Object.assign(salon, rest);
    if (lat !== undefined && lng !== undefined) {
      salon.location = { type: 'Point', coordinates: [lng, lat] };
    }
    return this.repo.save(salon);
  }

  async findPublicBySlug(slug: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ slug, status: 'approved' });
    if (!salon) throw new NotFoundException();
    return salon;
  }
}
```

- [ ] **Step 6: Controller** — `apps/api/src/salons/salons.controller.ts`

```typescript
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateSalonDto, UpdateSalonDto } from './dto/salon.dto';
import { SalonsService } from './salons.service';

@Controller('salons')
export class SalonsController {
  constructor(private readonly salons: SalonsService) {}

  @Post()
  @UseGuards(AuthGuard)
  create(@Req() req: Request, @Body() dto: CreateSalonDto) {
    return this.salons.createForOwner((req.user as User).id, dto);
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  mine(@Req() req: Request) {
    return this.salons.findMine((req.user as User).id);
  }

  @Patch('mine')
  @UseGuards(AuthGuard)
  update(@Req() req: Request, @Body() dto: UpdateSalonDto) {
    return this.salons.updateMine((req.user as User).id, dto);
  }

  @Get(':slug')
  publicProfile(@Param('slug') slug: string) {
    return this.salons.findPublicBySlug(slug);
  }
}
```

Route-order note: `mine` is declared before `:slug` so `/salons/mine` never matches the slug route.

- [ ] **Step 7: Module** — `apps/api/src/salons/salons.module.ts`, then register in `app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Salon } from './salon.entity';
import { SalonsController } from './salons.controller';
import { SalonsService } from './salons.service';

@Module({
  imports: [TypeOrmModule.forFeature([Salon]), AuthModule],
  controllers: [SalonsController],
  providers: [SalonsService],
  exports: [SalonsService, TypeOrmModule],
})
export class SalonsModule {}
```

- [ ] **Step 8: Write the e2e test** — `apps/api/test/salons.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

const salonPayload = {
  name: 'Rose Beauty',
  genderTarget: 'women',
  address: 'Valiasr St, No. 100',
  city: 'Tehran',
  lat: 35.7219,
  lng: 51.3347,
  capacity: 2,
};

describe('Salons (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09121110000');
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a salon (status pending) and promotes the owner to provider', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons')
      .set('Cookie', cookie)
      .send(salonPayload)
      .expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.slug).toMatch(/^rose-beauty-[0-9a-f]{4}$/);

    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.role).toBe('provider');
  });

  it('rejects a second salon for the same owner', () =>
    request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send(salonPayload).expect(409));

  it('returns my salon and updates it', async () => {
    const mine = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', cookie).expect(200);
    expect(mine.body.name).toBe('Rose Beauty');

    const upd = await request(app.getHttpServer())
      .patch('/api/salons/mine')
      .set('Cookie', cookie)
      .send({ capacity: 3 })
      .expect(200);
    expect(upd.body.capacity).toBe(3);
  });

  it('hides pending salons from the public route, shows approved ones', async () => {
    const mine = await request(app.getHttpServer()).get('/api/salons/mine').set('Cookie', cookie).expect(200);
    await request(app.getHttpServer()).get(`/api/salons/${mine.body.slug}`).expect(404);

    await app.get(DataSource).query(`UPDATE salons SET status = 'approved' WHERE id = $1`, [mine.body.id]);

    const pub = await request(app.getHttpServer()).get(`/api/salons/${mine.body.slug}`).expect(200);
    expect(pub.body.name).toBe('Rose Beauty');
  });

  it('requires auth to create', () =>
    request(app.getHttpServer()).post('/api/salons').send(salonPayload).expect(401));
});
```

- [ ] **Step 9: Run, fix, pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- salons`
Expected: PASS (5 tests).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/salons apps/api/src/app.module.ts apps/api/test/salons.e2e-spec.ts
git commit -m "feat(api): salon create/mine/update and public profile with pending gating"
```

---

### Task 11: Salon services CRUD (provider)

**Files:**
- Create: `apps/api/src/salons/salon-service.entity.ts`
- Create: `apps/api/src/salons/dto/salon-service.dto.ts`
- Create: `apps/api/src/salons/salon-services.controller.ts`
- Modify: `apps/api/src/salons/salons.module.ts`
- Test: `apps/api/test/salon-services.e2e-spec.ts`

- [ ] **Step 1: Entity** — `apps/api/src/salons/salon-service.entity.ts`

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

@Entity('salon_services')
export class SalonService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'category_id', type: 'int' })
  categoryId: number;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  price: number;

  @Column({ name: 'duration_min', type: 'int' })
  durationMin: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: DTOs** — `apps/api/src/salons/dto/salon-service.dto.ts`

```typescript
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateServiceDto {
  @Type(() => Number)
  @IsInt()
  categoryId: number;

  @IsString()
  @Length(2, 150)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  price: number;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(600)
  durationMin: number;
}

export class UpdateServiceDto {
  @IsOptional() @Type(() => Number) @IsInt() categoryId?: number;
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) price?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(600) durationMin?: number;
}
```

- [ ] **Step 3: Controller** — `apps/api/src/salons/salon-services.controller.ts`

All routes resolve the caller's salon first — a provider can only ever touch their own services. "Delete" archives.

```typescript
import {
  Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateServiceDto, UpdateServiceDto } from './dto/salon-service.dto';
import { SalonService } from './salon-service.entity';
import { SalonsService } from './salons.service';

@Controller('salons/mine/services')
@UseGuards(AuthGuard)
export class SalonServicesController {
  constructor(
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    private readonly salons: SalonsService,
  ) {}

  private async mySalonId(req: Request): Promise<string> {
    return (await this.salons.findMine((req.user as User).id)).id;
  }

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateServiceDto) {
    const salonId = await this.mySalonId(req);
    return this.services.save(this.services.create({ ...dto, salonId }));
  }

  @Get()
  async list(@Req() req: Request) {
    const salonId = await this.mySalonId(req);
    return this.services.find({ where: { salonId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  @Patch(':id')
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    const salonId = await this.mySalonId(req);
    const service = await this.services.findOneBy({ id, salonId, isActive: true });
    if (!service) throw new NotFoundException();
    Object.assign(service, dto);
    return this.services.save(service);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const salonId = await this.mySalonId(req);
    const result = await this.services.update({ id, salonId }, { isActive: false });
    if (!result.affected) throw new NotFoundException();
  }
}
```

- [ ] **Step 4: Register** — in `salons.module.ts`, add `SalonService` to `forFeature([...])`, add `SalonServicesController` to `controllers`.

Controller-order note: register `SalonServicesController` BEFORE `SalonsController` in the module's `controllers` array so `/salons/mine/services` wins over `/salons/:slug`.

- [ ] **Step 5: Write the e2e test** — `apps/api/test/salon-services.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon services (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09122220000');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 1',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  let serviceId: string;

  it('creates a service', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/services')
      .set('Cookie', cookie)
      .send({ categoryId: 1, name: 'Bob Haircut', price: 800000, durationMin: 45 })
      .expect(201);
    serviceId = res.body.id;
    expect(res.body.isActive).toBe(true);
  });

  it('lists active services', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/services')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].price).toBe(800000);
  });

  it('updates a service', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/salons/mine/services/${serviceId}`)
      .set('Cookie', cookie)
      .send({ price: 900000 })
      .expect(200);
    expect(res.body.price).toBe(900000);
  });

  it('archives on delete (disappears from list)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/salons/mine/services/${serviceId}`)
      .set('Cookie', cookie)
      .expect(204);
    const res = await request(app.getHttpServer())
      .get('/api/salons/mine/services')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.length).toBe(0);
  });

  it('rejects unauthenticated access', () =>
    request(app.getHttpServer()).get('/api/salons/mine/services').expect(401));
});
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- salon-services`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/salons apps/api/test/salon-services.e2e-spec.ts
git commit -m "feat(api): provider service crud with archive-on-delete"
```

---

### Task 12: Working hours & schedule exceptions

**Files:**
- Create: `apps/api/src/salons/working-hour.entity.ts`
- Create: `apps/api/src/salons/schedule-exception.entity.ts`
- Create: `apps/api/src/salons/dto/schedule.dto.ts`
- Create: `apps/api/src/salons/schedule.controller.ts`
- Modify: `apps/api/src/salons/salons.module.ts`
- Test: `apps/api/test/schedule.e2e-spec.ts`

- [ ] **Step 1: Entities**

`apps/api/src/salons/working-hour.entity.ts`:

```typescript
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('working_hours')
export class WorkingHour {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ type: 'smallint' })
  weekday: number;

  @Column({ name: 'open_time', type: 'time' })
  openTime: string;

  @Column({ name: 'close_time', type: 'time' })
  closeTime: string;
}
```

`apps/api/src/salons/schedule-exception.entity.ts`:

```typescript
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('schedule_exceptions')
export class ScheduleException {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'is_closed', default: true })
  isClosed: boolean;
}
```

- [ ] **Step 2: DTOs** — `apps/api/src/salons/dto/schedule.dto.ts`

```typescript
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, Matches, Max, Min, ValidateNested } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class HourRangeDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @Matches(HHMM)
  openTime: string;

  @Matches(HHMM)
  closeTime: string;
}

export class ReplaceHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HourRangeDto)
  hours: HourRangeDto[];
}

export class CreateExceptionDto {
  @Matches(ISO_DATE)
  date: string;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}
```

- [ ] **Step 3: Controller** — `apps/api/src/salons/schedule.controller.ts`

Hours use replace-all semantics (PUT) — matches the weekly-template UX in the provider panel.

```typescript
import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource, Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateExceptionDto, ReplaceHoursDto } from './dto/schedule.dto';
import { SalonsService } from './salons.service';
import { ScheduleException } from './schedule-exception.entity';
import { WorkingHour } from './working-hour.entity';

@Controller('salons/mine')
@UseGuards(AuthGuard)
export class ScheduleController {
  constructor(
    @InjectRepository(WorkingHour) private readonly hours: Repository<WorkingHour>,
    @InjectRepository(ScheduleException) private readonly exceptions: Repository<ScheduleException>,
    private readonly salons: SalonsService,
    private readonly dataSource: DataSource,
  ) {}

  private async mySalonId(req: Request): Promise<string> {
    return (await this.salons.findMine((req.user as User).id)).id;
  }

  @Put('hours')
  async replaceHours(@Req() req: Request, @Body() dto: ReplaceHoursDto) {
    for (const h of dto.hours) {
      if (h.openTime >= h.closeTime) {
        throw new BadRequestException(`openTime must be before closeTime (weekday ${h.weekday})`);
      }
    }
    const salonId = await this.mySalonId(req);
    return this.dataSource.transaction(async (em) => {
      await em.delete(WorkingHour, { salonId });
      return em.save(WorkingHour, dto.hours.map((h) => ({ ...h, salonId })));
    });
  }

  @Get('hours')
  async listHours(@Req() req: Request) {
    const salonId = await this.mySalonId(req);
    return this.hours.find({ where: { salonId }, order: { weekday: 'ASC', openTime: 'ASC' } });
  }

  @Post('exceptions')
  async addException(@Req() req: Request, @Body() dto: CreateExceptionDto) {
    const salonId = await this.mySalonId(req);
    return this.exceptions.save(
      this.exceptions.create({ salonId, date: dto.date, isClosed: dto.isClosed ?? true }),
    );
  }

  @Get('exceptions')
  async listExceptions(@Req() req: Request) {
    const salonId = await this.mySalonId(req);
    return this.exceptions.find({ where: { salonId }, order: { date: 'ASC' } });
  }

  @Delete('exceptions/:id')
  @HttpCode(204)
  async removeException(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const salonId = await this.mySalonId(req);
    const result = await this.exceptions.delete({ id, salonId });
    if (!result.affected) throw new NotFoundException();
  }
}
```

- [ ] **Step 4: Register** — add both entities to `forFeature([...])` and `ScheduleController` to `controllers` in `salons.module.ts` (before `SalonsController`, same route-order reason).

- [ ] **Step 5: Write the e2e test** — `apps/api/test/schedule.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Schedule (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    cookie = await loginAs(app, '09123330000');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', cookie).send({
      name: 'Sched Salon',
      genderTarget: 'women',
      address: 'Azadi St, No. 5',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.35,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('replaces the weekly hours', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [
        { weekday: 6, openTime: '09:00', closeTime: '18:00' },
        { weekday: 0, openTime: '09:00', closeTime: '13:00' },
        { weekday: 0, openTime: '15:00', closeTime: '20:00' },
      ]})
      .expect(200);
    expect(res.body.length).toBe(3);

    const res2 = await request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [{ weekday: 1, openTime: '10:00', closeTime: '19:00' }] })
      .expect(200);
    expect(res2.body.length).toBe(1);

    const list = await request(app.getHttpServer())
      .get('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.length).toBe(1);
  });

  it('rejects an inverted range', () =>
    request(app.getHttpServer())
      .put('/api/salons/mine/hours')
      .set('Cookie', cookie)
      .send({ hours: [{ weekday: 1, openTime: '18:00', closeTime: '09:00' }] })
      .expect(400));

  it('adds and removes a closed-day exception', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/salons/mine/exceptions')
      .set('Cookie', cookie)
      .send({ date: '2026-08-01' })
      .expect(201);
    expect(created.body.isClosed).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/salons/mine/exceptions/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/api/salons/mine/exceptions')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.length).toBe(0);
  });
});
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- schedule`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/salons apps/api/test/schedule.e2e-spec.ts
git commit -m "feat(api): weekly hours (replace-all) and schedule exceptions"
```

---

### Task 13: Geo search endpoint

**Files:**
- Create: `apps/api/src/search/dto/search.dto.ts`
- Create: `apps/api/src/search/search.service.ts`
- Create: `apps/api/src/search/search.controller.ts`
- Create: `apps/api/src/search/search.module.ts`
- Test: `apps/api/test/search.e2e-spec.ts`

- [ ] **Step 1: Write the failing e2e test** — `apps/api/test/search.e2e-spec.ts`

Seeds four salons around a Tehran anchor point directly through SQL (approval is an admin action — Plan 5), then exercises distance ordering, gender filtering, status gating, radius, and category filtering.

```typescript
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

const ANCHOR = { lat: 35.7219, lng: 51.3347 };

describe('Search (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    const ds = app.get(DataSource);

    // owner users
    await ds.query(`
      INSERT INTO users (id, phone, role) VALUES
        ('00000000-0000-4000-8000-000000000001', '09120000001', 'provider'),
        ('00000000-0000-4000-8000-000000000002', '09120000002', 'provider'),
        ('00000000-0000-4000-8000-000000000003', '09120000003', 'provider'),
        ('00000000-0000-4000-8000-000000000004', '09120000004', 'provider')`);

    // near: ~0km; far: ~2.2km east; men: near but wrong gender; pending: near but not approved
    await ds.query(`
      INSERT INTO salons (id, owner_id, name, slug, gender_target, status, address, city, location) VALUES
        ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
         'Near Salon', 'near-salon', 'women', 'approved', 'A', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3347, 35.7219), 4326)::geography),
        ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
         'Far Salon', 'far-salon', 'women', 'approved', 'B', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3590, 35.7219), 4326)::geography),
        ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003',
         'Mens Salon', 'mens-salon', 'men', 'approved', 'C', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3350, 35.7220), 4326)::geography),
        ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004',
         'Pending Salon', 'pending-salon', 'women', 'pending', 'D', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.3348, 35.7218), 4326)::geography)`);

    // services: Near has Haircut(cat 1, 500k); Far has Nails(cat 4, 300k)
    await ds.query(`
      INSERT INTO salon_services (salon_id, category_id, name, price, duration_min) VALUES
        ('10000000-0000-4000-8000-000000000001', 1, 'Cut', 500000, 45),
        ('10000000-0000-4000-8000-000000000002', 4, 'Manicure', 300000, 60)`);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns approved women salons ordered by distance with minPrice', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women' })
      .expect(200);

    expect(res.body.map((s: { slug: string }) => s.slug)).toEqual(['near-salon', 'far-salon']);
    expect(res.body[0].distanceKm).toBeLessThan(0.1);
    expect(res.body[1].distanceKm).toBeGreaterThan(1.5);
    expect(res.body[0].minPrice).toBe(500000);
  });

  it('respects the radius', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', radiusKm: 1 })
      .expect(200);
    expect(res.body.map((s: { slug: string }) => s.slug)).toEqual(['near-salon']);
  });

  it('filters by category', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', categoryId: 4 })
      .expect(200);
    expect(res.body.map((s: { slug: string }) => s.slug)).toEqual(['far-salon']);
  });

  it('filters men salons for gender=men', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'men' })
      .expect(200);
    expect(res.body.map((s: { slug: string }) => s.slug)).toEqual(['mens-salon']);
  });

  it('sorts by rating when requested', async () => {
    const ds = app.get(DataSource);
    await ds.query(
      `UPDATE salons SET rating_avg = 4.9, rating_count = 10 WHERE slug = 'far-salon'`,
    );
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng, gender: 'women', sort: 'rating' })
      .expect(200);
    expect(res.body[0].slug).toBe('far-salon');
  });

  it('rejects a missing gender param', () =>
    request(app.getHttpServer())
      .get('/api/search')
      .query({ lat: ANCHOR.lat, lng: ANCHOR.lng })
      .expect(400));
});
```

Run: `pnpm --filter @arayeshgah/api test:e2e -- search`
Expected: FAIL (404).

- [ ] **Step 2: DTO** — `apps/api/src/search/dto/search.dto.ts`

```typescript
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, Max, Min } from 'class-validator';

export class SearchQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @IsIn(['women', 'men'])
  gender: 'women' | 'men';

  @IsOptional()
  @Type(() => Number)
  @Min(0.5)
  @Max(50)
  radiusKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsIn(['distance', 'rating'])
  sort?: 'distance' | 'rating';
}
```

- [ ] **Step 3: Service** — `apps/api/src/search/search.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SearchQueryDto } from './dto/search.dto';

export interface SearchResult {
  id: string;
  name: string;
  slug: string;
  city: string;
  address: string;
  ratingAvg: number;
  ratingCount: number;
  distanceKm: number;
  minPrice: number | null;
  coverPhoto: string | null;
}

@Injectable()
export class SearchService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async search(q: SearchQueryDto): Promise<SearchResult[]> {
    const radiusMeters = (q.radiusKm ?? 5) * 1000;
    const orderBy = q.sort === 'rating' ? 's.rating_avg DESC, distance_km ASC' : 'distance_km ASC';

    const rows = await this.dataSource.query(
      `
      SELECT
        s.id, s.name, s.slug, s.city, s.address,
        s.rating_avg, s.rating_count,
        ST_Distance(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS distance_km,
        (SELECT MIN(ss.price) FROM salon_services ss
           WHERE ss.salon_id = s.id AND ss.is_active
             AND ($5::int IS NULL OR ss.category_id = $5)) AS min_price,
        (SELECT sp.url FROM salon_photos sp
           WHERE sp.salon_id = s.id ORDER BY sp.is_cover DESC, sp.sort_order ASC LIMIT 1) AS cover_photo
      FROM salons s
      WHERE s.status = 'approved'
        AND s.gender_target = $3
        AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
        AND ($5::int IS NULL OR EXISTS (
          SELECT 1 FROM salon_services ss2
          WHERE ss2.salon_id = s.id AND ss2.category_id = $5 AND ss2.is_active))
      ORDER BY ${orderBy}
      LIMIT 50
      `,
      [q.lng, q.lat, q.gender, radiusMeters, q.categoryId ?? null],
    );

    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      slug: r.slug as string,
      city: r.city as string,
      address: r.address as string,
      ratingAvg: Number(r.rating_avg),
      ratingCount: Number(r.rating_count),
      distanceKm: Number(r.distance_km),
      minPrice: r.min_price === null ? null : Number(r.min_price),
      coverPhoto: (r.cover_photo as string) ?? null,
    }));
  }
}
```

`orderBy` is interpolated but only ever from the two hardcoded strings above — never from user input.

- [ ] **Step 4: Controller + module**

`apps/api/src/search/search.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { SearchQueryDto } from './dto/search.dto';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  run(@Query() query: SearchQueryDto) {
    return this.search.search(query);
  }
}
```

`apps/api/src/search/search.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
```

Register `SearchModule` in `app.module.ts` imports.

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @arayeshgah/api test:e2e -- search`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/search apps/api/src/app.module.ts apps/api/test/search.e2e-spec.ts
git commit -m "feat(api): postgis geo search with gender, radius, category, and rating sort"
```

---

### Task 14: Full-suite verification & README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run everything**

Run: `pnpm --filter @arayeshgah/api test && pnpm --filter @arayeshgah/api test:e2e && pnpm build`
Expected: all unit tests PASS, all e2e suites PASS, build succeeds.

- [ ] **Step 2: Create `README.md`**

```markdown
# Arayeshgah

Salon discovery & booking marketplace (Iran). Spec: `docs/superpowers/specs/2026-07-04-arayeshgah-marketplace-design.md`.

## Structure

- `apps/api` — NestJS modular monolith (PostgreSQL + PostGIS, Redis)
- `apps/user-app` — Nuxt 3 PWA (Plan 3)
- `apps/provider-panel` — Vue 3 SPA (Plan 4)
- `apps/admin-panel` — Vue 3 SPA (Plan 5)

## Getting started

```bash
docker compose up -d          # postgres (postgis) + redis
cp .env.example apps/api/.env
pnpm install
pnpm --filter @arayeshgah/api migration:run
pnpm dev:api                  # http://localhost:3000/api/health
```

## Tests

```bash
pnpm --filter @arayeshgah/api test        # unit
pnpm --filter @arayeshgah/api test:e2e    # e2e (needs docker services)
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add project readme with setup instructions"
```

---

## Done — definition of success

- `docker compose up -d` + `pnpm install` + `migration:run` + `pnpm dev:api` gives a working API.
- A phone can log in via OTP (console-logged in dev) and get a session cookie.
- A provider can create a salon (pending), define services, hours, and exceptions.
- Once a salon is approved (DB update until Plan 5), it appears in `/api/search` with distance, rating, and min price, and its public profile is served by slug.
- All unit and e2e suites green.

**Next plans:** Plan 2 (booking engine: availability computation, holds, Zarinpal deposits, reviews, SMS notifications) builds directly on `working_hours`, `schedule_exceptions`, `salon_services`, and `platform_config` created here.

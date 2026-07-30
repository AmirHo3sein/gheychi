# Plan 9: Production Deployment Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gheychi deployable to a real single-VPS `docker compose` stack — Docker images for all four apps, a production compose file with a Caddy TLS reverse proxy, a GitHub Actions CI pipeline (test everything, build+push images to GHCR on `main`), and the real Kavenegar/Zarinpal/S3/WebPush providers hardened and documented for cutover.

**Architecture:** One multi-stage `Dockerfile` per app using Turborepo's `turbo prune --docker` pattern (pruner → installer → runner). `docker-compose.prod.yml` adds the four app images plus a Caddy reverse-proxy container to the existing Postgres/Redis services, all pre-built by CI and pulled — never built on the VPS. A single GitHub Actions workflow runs the full test suite on every push/PR and, on `main` only, builds and pushes the four images to GHCR. Deploy to the VPS stays a manual documented `git pull`-free `docker compose pull && up -d` step.

**Tech Stack:** Docker (multi-stage builds, Alpine base images), Turborepo (`turbo prune`), GitHub Actions, GHCR, Caddy 2, nginx (static SPA serving), `@smithy/node-http-handler` (S3 request timeouts).

---

## Before You Start

This plan touches real external service credentials only in documentation (§9 of the design spec) — no task here requires a real Kavenegar/Zarinpal/S3 account. All new tests run against mocked providers, exactly like the existing provider spec files.

Read `docs/superpowers/specs/2026-07-11-plan-9-production-deployment-design.md` first for the full rationale behind every decision below (domains, why the API image keeps devDependencies, why migrations are a manual step, etc.).

All commands below assume the repo root (`~/projects/Gheychi`) as the working directory unless a task says otherwise.

---

## Task 1: Kavenegar SMS provider — bound both requests with a network timeout

`fetch()` has no default timeout in Node 20. An unbounded OTP-send request could hang a customer's login/booking flow indefinitely if Kavenegar's API stalls. `AbortSignal.timeout()` bounds it and rejects with a normal error the existing catch block already handles.

**Files:**
- Modify: `apps/api/src/sms/kavenegar-sms.provider.ts`
- Test: `apps/api/src/sms/kavenegar-sms.provider.spec.ts`

- [ ] **Step 1: Write the failing test**

Add this test to the end of the existing `describe('KavenegarSmsProvider', ...)` block in `apps/api/src/sms/kavenegar-sms.provider.spec.ts` (before the closing `})`):

```ts
  it('bounds both requests with a network timeout', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ return: { status: 200 } }),
    });
    const provider = new KavenegarSmsProvider('MY_KEY', 'my-template');
    await provider.sendOtp('09121234567', '123456');
    await provider.send('09121234567', 'hi');

    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1][1]?.signal).toBeInstanceOf(AbortSignal);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gheychi/api test -- kavenegar-sms.provider.spec.ts`
Expected: FAIL — `fetchMock.mock.calls[0][1]` is `undefined` because `fetch(url)` is currently called with no second argument.

- [ ] **Step 3: Write the minimal implementation**

Replace the full contents of `apps/api/src/sms/kavenegar-sms.provider.ts` with:

```ts
import { Injectable } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

interface KavenegarResponse {
  return?: {
    status: number;
    message?: string;
  };
}

const KAVENEGAR_TIMEOUT_MS = 10_000;

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
    // URL embeds the OTP code and phone number as query params (matches Kavenegar's
    // documented API) — must never be logged verbatim by request-logging middleware.
    const url = `https://api.kavenegar.com/v1/${this.apiKey}/verify/lookup.json?${params}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(KAVENEGAR_TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`Kavenegar send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = (await res.json()) as KavenegarResponse;
    if (!res.ok || body?.return?.status !== 200) {
      throw new Error(`Kavenegar send failed: ${body?.return?.message ?? res.status}`);
    }
  }

  async send(phone: string, message: string): Promise<void> {
    const params = new URLSearchParams({ receptor: phone, message });
    const url = `https://api.kavenegar.com/v1/${this.apiKey}/sms/send.json?${params}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(KAVENEGAR_TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`Kavenegar send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = (await res.json()) as KavenegarResponse;
    if (!res.ok || body?.return?.status !== 200) {
      throw new Error(`Kavenegar send failed: ${body?.return?.message ?? res.status}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test -- kavenegar-sms.provider.spec.ts`
Expected: PASS (6 tests: the 5 pre-existing plus the new timeout test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sms/kavenegar-sms.provider.ts apps/api/src/sms/kavenegar-sms.provider.spec.ts
git commit -m "fix(api): bound Kavenegar SMS requests with a 10s network timeout"
```

---

## Task 2: Zarinpal payment gateway — bound both requests with a network timeout

Same gap as Task 1: `requestPayment`/`verifyPayment` call `fetch()` with no timeout. An unbounded verify call sits directly in the booking-payment callback path.

**Files:**
- Modify: `apps/api/src/booking/zarinpal-payment.gateway.ts`
- Test: `apps/api/src/booking/zarinpal-payment.gateway.spec.ts`

- [ ] **Step 1: Write the failing test**

Add this test to the end of the existing `describe('ZarinpalGateway', ...)` block in `apps/api/src/booking/zarinpal-payment.gateway.spec.ts` (before the closing `})`):

```ts
  it('bounds both requests with a network timeout', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 100, authority: 'AUTH123', message: 'ok' }, errors: [] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    await gateway.requestPayment(200000, 'x', 'https://x.com/cb');
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 100, ref_id: 1, message: 'ok' }, errors: [] }),
    });
    await gateway.verifyPayment('AUTH123', 200000);
    expect(fetchMock.mock.calls[1][1]?.signal).toBeInstanceOf(AbortSignal);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gheychi/api test -- zarinpal-payment.gateway.spec.ts`
Expected: FAIL — neither fetch call currently sets `signal`.

- [ ] **Step 3: Write the minimal implementation**

In `apps/api/src/booking/zarinpal-payment.gateway.ts`, add the constant right after the existing `const TOMAN_TO_RIAL = 10;` line:

```ts
const TOMAN_TO_RIAL = 10;
const ZARINPAL_TIMEOUT_MS = 10_000;
```

Then update the `requestPayment` fetch call:

```ts
      res = await fetch(REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(ZARINPAL_TIMEOUT_MS),
        body: JSON.stringify({
          merchant_id: this.merchantId,
          amount: amountToman * TOMAN_TO_RIAL,
          callback_url: callbackUrl,
          description,
        }),
      });
```

And the `verifyPayment` fetch call:

```ts
      res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(ZARINPAL_TIMEOUT_MS),
        body: JSON.stringify({
          merchant_id: this.merchantId,
          amount: amountToman * TOMAN_TO_RIAL,
          authority,
        }),
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test -- zarinpal-payment.gateway.spec.ts`
Expected: PASS (9 tests: the 8 pre-existing plus the new timeout test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/booking/zarinpal-payment.gateway.ts apps/api/src/booking/zarinpal-payment.gateway.spec.ts
git commit -m "fix(api): bound Zarinpal payment requests with a 10s network timeout"
```

---

## Task 3: S3 storage provider — bound every request with connection/request timeouts

AWS SDK v3's `NodeHttpHandler` defaults both `connectionTimeout` and `requestTimeout` to `0` (disabled) unless configured explicitly — confirmed against the AWS SDK v3 docs and the installed `@smithy/node-http-handler` type declarations. An unbounded photo upload could hang a provider's request indefinitely if S3 stalls.

**Files:**
- Modify: `apps/api/package.json` (new dependency)
- Modify: `apps/api/src/storage/s3-storage.provider.ts`
- Test: `apps/api/src/storage/s3-storage.provider.spec.ts`

- [ ] **Step 1: Add the `@smithy/node-http-handler` dependency**

`@smithy/node-http-handler` is already resolved transitively (via `@aws-sdk/client-s3`), but importing it directly requires declaring it as a direct dependency — otherwise it's a "phantom dependency" that pnpm's strict `node_modules` layout won't expose to `apps/api`.

Run: `pnpm --filter @gheychi/api add @smithy/node-http-handler`
Expected: `apps/api/package.json`'s `dependencies` gains a `"@smithy/node-http-handler"` entry (pnpm resolves it to the same `4.9.3` already in the lockfile); `pnpm-lock.yaml` updates accordingly.

- [ ] **Step 2: Write the failing test**

Add this import to the top of `apps/api/src/storage/s3-storage.provider.spec.ts`, right after the existing `S3Client` import:

```ts
import { NodeHttpHandler } from '@smithy/node-http-handler';
```

Add this mock right after the existing `jest.mock('@aws-sdk/client-s3', ...)` block:

```ts
jest.mock('@smithy/node-http-handler', () => ({
  NodeHttpHandler: jest.fn(() => ({ __mockHandler: true })),
}));
```

Add this test to the end of the existing `describe('S3StorageProvider', ...)` block (before the closing `})`). It reads the single `provider` instantiated at the top of the file (there is no `beforeEach` in this spec, so every mock's call history covers that one construction — same pattern the existing "uploads via PutObjectCommand" test already relies on via `S3Client.mock.results[0]`):

```ts
  it('bounds every S3 request with connection and request timeouts', () => {
    expect(NodeHttpHandler).toHaveBeenCalledWith({ connectionTimeout: 5_000, requestTimeout: 10_000 });
    const handlerInstance = (NodeHttpHandler as unknown as jest.Mock).mock.results[0].value;
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ requestHandler: handlerInstance }),
    );
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @gheychi/api test -- s3-storage.provider.spec.ts`
Expected: FAIL — `NodeHttpHandler` mock has zero calls because the provider doesn't construct one yet.

- [ ] **Step 4: Write the minimal implementation**

Replace the full contents of `apps/api/src/storage/s3-storage.provider.ts` with:

```ts
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Injectable } from '@nestjs/common';
import { StorageProvider } from './storage.provider';

const S3_CONNECTION_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 10_000;

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
      requestHandler: new NodeHttpHandler({
        connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
        requestTimeout: S3_REQUEST_TIMEOUT_MS,
      }),
    });
  }

  async upload(buffer: Buffer, key: string, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
    );
    return this.publicUrl(key);
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test -- s3-storage.provider.spec.ts`
Expected: PASS (4 tests: the 3 pre-existing plus the new timeout test)

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/storage/s3-storage.provider.ts apps/api/src/storage/s3-storage.provider.spec.ts
git commit -m "fix(api): bound S3 storage requests with connection/request timeouts"
```

---

## Task 4: Web Push provider — add a send timeout and its first test coverage

`WebPushProvider` has zero test coverage today (no `.spec.ts` file exists). The `web-push` library's `sendNotification(subscription, payload, options)` accepts a `timeout` option (confirmed in the installed `@types/web-push` declarations) that defaults to `undefined` (no timeout) — the same unbounded-request gap as the other three providers.

**Files:**
- Modify: `apps/api/src/push/web-push.provider.ts`
- Create: `apps/api/src/push/web-push.provider.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/push/web-push.provider.spec.ts`:

```ts
import webpush from 'web-push';
import { WebPushProvider } from './web-push.provider';

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
  },
}));

describe('WebPushProvider', () => {
  const mockedWebpush = webpush as jest.Mocked<typeof webpush>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets VAPID details on construction', () => {
    new WebPushProvider('public-key', 'private-key', 'mailto:test@example.com');
    expect(mockedWebpush.setVapidDetails).toHaveBeenCalledWith('mailto:test@example.com', 'public-key', 'private-key');
  });

  it('sends a notification with the subscription, JSON payload, and a request timeout', async () => {
    mockedWebpush.sendNotification.mockResolvedValue({} as never);
    const provider = new WebPushProvider('public-key', 'private-key', 'mailto:test@example.com');
    await provider.send(
      { endpoint: 'https://push.example.com/abc', p256dh: 'p256dh-key', auth: 'auth-key' },
      { title: 'سلام', body: 'نوبت شما تایید شد' },
    );

    expect(mockedWebpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } },
      JSON.stringify({ title: 'سلام', body: 'نوبت شما تایید شد' }),
      { timeout: 10_000 },
    );
  });

  it('rethrows a send failure after logging it', async () => {
    mockedWebpush.sendNotification.mockRejectedValue(new Error('410 Gone'));
    const provider = new WebPushProvider('public-key', 'private-key', 'mailto:test@example.com');
    await expect(
      provider.send({ endpoint: 'https://push.example.com/abc', p256dh: 'k', auth: 'a' }, { title: 't', body: 'b' }),
    ).rejects.toThrow('410 Gone');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gheychi/api test -- web-push.provider.spec.ts`
Expected: FAIL on the second test — `sendNotification` is currently called with only 2 arguments (no `options` object), so the assertion on the third call argument fails.

- [ ] **Step 3: Write the minimal implementation**

Replace the full contents of `apps/api/src/push/web-push.provider.ts` with:

```ts
import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { PushPayload, PushProvider, PushTarget } from './push.provider';

const PUSH_TIMEOUT_MS = 10_000;

@Injectable()
export class WebPushProvider implements PushProvider {
  private readonly logger = new Logger('Push');

  constructor(publicKey: string, privateKey: string, subject: string) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { timeout: PUSH_TIMEOUT_MS },
      );
    } catch (err) {
      this.logger.warn(`Push send failed for ${target.endpoint}: ${(err as Error).message}`);
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test -- web-push.provider.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/push/web-push.provider.ts apps/api/src/push/web-push.provider.spec.ts
git commit -m "fix(api): bound Web Push requests with a 10s timeout, add first test coverage"
```

---

## Task 5: Root `.dockerignore`

Every Dockerfile in this plan builds with the repo root as its context (needed so `turbo prune` can see the whole workspace). Without a `.dockerignore`, that context includes every app's `node_modules`, build output, and test artifacts — slow to send to the Docker daemon and liable to shadow the pruner stage's own fresh install.

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create the file**

Create `.dockerignore` at the repo root:

```
**/node_modules
**/.turbo
**/dist
**/.output
**/.nuxt
**/coverage
**/test-results
**/playwright-report
.git
.vscode
*.log
```

- [ ] **Step 2: Verify it's picked up**

Run: `docker build -f apps/api/Dockerfile -t gheychi-api:context-check --target pruner .`

This will fail at this point in the plan (`apps/api/Dockerfile` doesn't exist until Task 6) — that's expected. This step just confirms the command syntax; skip actually running it until Task 6 exists, and re-verify context size then with `docker build --progress=plain ... 2>&1 | grep "transferring context"` to confirm `node_modules` isn't in the transferred bytes.

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "chore: add root .dockerignore for Docker build contexts"
```

---

## Task 6: `apps/api/Dockerfile`

Multi-stage build using `turbo prune @gheychi/api --docker`. The runner stage deliberately keeps the full pruned source tree and all dependencies (including devDependencies) rather than shipping only `dist/` — this lets the existing `pnpm migration:run` script (which uses `typeorm-ts-node-commonjs` against `src/data-source.ts`) run unchanged inside the production container via `docker compose exec`, per the design doc's §4/§7 tradeoff.

**Files:**
- Create: `apps/api/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `apps/api/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-alpine AS pruner
WORKDIR /app
RUN npm install -g turbo@2
COPY . .
RUN turbo prune @gheychi/api --docker

FROM node:20-alpine AS installer
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@gheychi/api

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 apiuser
COPY --from=installer --chown=apiuser:nodejs /app .
USER apiuser
EXPOSE 3002
CMD ["node", "apps/api/dist/src/main.js"]
```

The `dist/src/main.js` path (not `dist/main.js`) is deliberate: `apps/api/tsconfig.json` has no `rootDir` set, and TypeScript infers it as the longest common path across `src/`, `scripts/`, and `test/` (all siblings under `apps/api/`) — so `nest build` mirrors that under `dist/`, landing the compiled entrypoint at `dist/src/main.js`. Verified by running `pnpm --filter @gheychi/api build && find apps/api/dist -iname main.js` locally before writing this task.

- [ ] **Step 2: Build the image**

Run: `docker build -f apps/api/Dockerfile -t gheychi-api:test .`
Expected: build completes through all three stages with no errors.

- [ ] **Step 3: Smoke-test the container**

The dev Postgres/Redis from the root `docker-compose.yml` must already be running (`docker compose up -d`) for this step.

Run:
```bash
docker run --rm -d --name gheychi-api-smoke -p 3002:3002 \
  --env-file apps/api/.env.test \
  -e DB_HOST=host.docker.internal -e REDIS_HOST=host.docker.internal \
  gheychi-api:test
sleep 3
curl -f http://localhost:3002/api/health
docker stop gheychi-api-smoke
```
Expected: the `curl` returns a 2xx response (the existing `HealthController`'s response body). `host.docker.internal` resolves to the host machine's Docker Desktop gateway, letting the container reach the dev Postgres/Redis already bound to `localhost:5544`/`localhost:6381` on the host.

- [ ] **Step 4: Commit**

```bash
git add apps/api/Dockerfile
git commit -m "feat(deploy): add production Dockerfile for apps/api"
```

---

## Task 7: `apps/user-app/Dockerfile`

Nuxt's default Nitro preset (`node-server`, since no platform-specific env vars are set during a plain `nuxt build`) produces a self-contained `.output/` directory that bundles its own server dependencies — the runner stage needs nothing from `node_modules`.

**Files:**
- Create: `apps/user-app/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `apps/user-app/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-alpine AS pruner
WORKDIR /app
RUN npm install -g turbo@2
COPY . .
RUN turbo prune @gheychi/user-app --docker

FROM node:20-alpine AS installer
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@gheychi/user-app

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nuxtuser
COPY --from=installer --chown=nuxtuser:nodejs /app/apps/user-app/.output ./.output
USER nuxtuser
ENV HOST=0.0.0.0
ENV PORT=3003
EXPOSE 3003
CMD ["node", ".output/server/index.mjs"]
```

- [ ] **Step 2: Build the image**

Run: `docker build -f apps/user-app/Dockerfile -t gheychi-user-app:test .`
Expected: build completes; the Nitro build step (`pnpm turbo run build --filter=@gheychi/user-app`) is the slowest part (cold Nuxt/Vite compile, similar to the Playwright config's measured ~78s note for `nuxt dev` — a production `nuxt build` is comparably heavy).

- [ ] **Step 3: Smoke-test the container**

Run:
```bash
docker run --rm -d --name gheychi-user-app-smoke -p 3003:3003 \
  -e NUXT_PUBLIC_API_BASE=http://localhost:3002/api \
  gheychi-user-app:test
sleep 3
curl -f http://localhost:3003 | grep -q "<!DOCTYPE html>"
docker stop gheychi-user-app-smoke
```
Expected: the response contains server-rendered HTML (confirms SSR is working, not just a static shell). The app doesn't need a reachable API for this smoke test — pages that fail their `apiFetch` calls degrade to empty/error states per `useApi()`'s `silent` handling, they don't crash the server.

- [ ] **Step 4: Commit**

```bash
git add apps/user-app/Dockerfile
git commit -m "feat(deploy): add production Dockerfile for apps/user-app"
```

---

## Task 8: Shared nginx SPA config + `apps/provider-panel/Dockerfile`

Both Vue SPAs (`provider-panel`, `admin-panel`) need the same static-file server behavior: serve `dist/`, fall back to `index.html` for client-side routing, cache hashed assets. One shared nginx config file avoids duplicating it.

**Files:**
- Create: `docker/nginx-spa.conf`
- Create: `apps/provider-panel/Dockerfile`

- [ ] **Step 1: Write the shared nginx config**

Create `docker/nginx-spa.conf`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(?:css|js|svg|woff2?|png|jpg|jpeg|gif|ico)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

- [ ] **Step 2: Write the Dockerfile**

`VITE_API_BASE` is a build-time Vite env var (baked into the static bundle) — it defaults to `http://localhost:3002/api` (matching the app's own in-code fallback and its `.env.example`) so a plain `docker build` with no `--build-arg` still produces a working local-pointing image; CI overrides it with the real production API URL (Task 13).

Create `apps/provider-panel/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-alpine AS pruner
WORKDIR /app
RUN npm install -g turbo@2
COPY . .
RUN turbo prune @gheychi/provider-panel --docker

FROM node:20-alpine AS installer
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
ARG VITE_API_BASE=http://localhost:3002/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm turbo run build --filter=@gheychi/provider-panel

FROM nginx:1.27-alpine AS runner
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=installer /app/apps/provider-panel/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 3: Build and smoke-test the image**

Run:
```bash
docker build -f apps/provider-panel/Dockerfile -t gheychi-provider-panel:test .
docker run --rm -d --name gheychi-provider-panel-smoke -p 8081:80 gheychi-provider-panel:test
sleep 1
curl -f http://localhost:8081 | grep -q "<div id=\"app\">"
curl -f http://localhost:8081/some/deep/client/route | grep -q "<div id=\"app\">"
docker stop gheychi-provider-panel-smoke
```
Expected: both requests return the same `index.html` shell (200, not 404) — the second confirms nginx's SPA fallback (`try_files ... /index.html`) is working for a client-side route.

- [ ] **Step 4: Commit**

```bash
git add docker/nginx-spa.conf apps/provider-panel/Dockerfile
git commit -m "feat(deploy): add production Dockerfile for apps/provider-panel"
```

---

## Task 9: `apps/admin-panel/Dockerfile`

Identical shape to Task 8, reusing the same `docker/nginx-spa.conf`.

**Files:**
- Create: `apps/admin-panel/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `apps/admin-panel/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-alpine AS pruner
WORKDIR /app
RUN npm install -g turbo@2
COPY . .
RUN turbo prune @gheychi/admin-panel --docker

FROM node:20-alpine AS installer
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
ARG VITE_API_BASE=http://localhost:3002/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm turbo run build --filter=@gheychi/admin-panel

FROM nginx:1.27-alpine AS runner
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=installer /app/apps/admin-panel/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 2: Build and smoke-test the image**

Run:
```bash
docker build -f apps/admin-panel/Dockerfile -t gheychi-admin-panel:test .
docker run --rm -d --name gheychi-admin-panel-smoke -p 8082:80 gheychi-admin-panel:test
sleep 1
curl -f http://localhost:8082 | grep -q "<div id=\"app\">"
docker stop gheychi-admin-panel-smoke
```
Expected: 200 with the app shell.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-panel/Dockerfile
git commit -m "feat(deploy): add production Dockerfile for apps/admin-panel"
```

---

## Task 10: `docker-compose.prod.yml`

A second compose file, separate from the dev-only root `docker-compose.yml` (which is untouched). Only Caddy publishes a host port; Postgres/Redis lose their dev host-port mappings since nothing outside the Docker network needs to reach them directly in production.

**Files:**
- Create: `docker-compose.prod.yml`

- [ ] **Step 1: Write the compose file**

Create `docker-compose.prod.yml`:

```yaml
services:
  postgres:
    image: postgis/postgis:16-3.4
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASS}
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [internal]

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    networks: [internal]

  api:
    image: ghcr.io/amirho3sein/gheychi-api:latest
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3002/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
    networks: [internal]

  user-app:
    image: ghcr.io/amirho3sein/gheychi-user-app:latest
    restart: unless-stopped
    env_file: .env
    depends_on: [api]
    networks: [internal]

  provider-panel:
    image: ghcr.io/amirho3sein/gheychi-provider-panel:latest
    restart: unless-stopped
    depends_on: [api]
    networks: [internal]

  admin-panel:
    image: ghcr.io/amirho3sein/gheychi-admin-panel:latest
    restart: unless-stopped
    depends_on: [api]
    networks: [internal]

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    env_file: .env
    depends_on: [api, user-app, provider-panel, admin-panel]
    networks: [internal]

networks:
  internal:

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

- [ ] **Step 2: Validate the compose file's syntax**

Run: `docker compose -f docker-compose.prod.yml config --quiet`
Expected: no output, exit code 0 (the `--quiet` flag suppresses the resolved config dump and only reports errors). This will warn about missing `.env` variables at this point in the plan — that's expected until Task 11 adds them; re-run once a `.env` exists locally with dummy values to fully validate.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat(deploy): add production docker-compose stack"
```

---

## Task 11: Caddyfile + `.env.example` domain/ACME vars

**Files:**
- Create: `Caddyfile`
- Modify: `.env.example`

- [ ] **Step 1: Write the Caddyfile**

Create `Caddyfile` at the repo root:

```
{
	email {$ACME_EMAIL}
}

{$DOMAIN_APEX}, www.{$DOMAIN_APEX} {
	reverse_proxy user-app:3003
}

{$DOMAIN_API} {
	reverse_proxy api:3002
}

{$DOMAIN_PANEL} {
	reverse_proxy provider-panel:80
}

{$DOMAIN_ADMIN} {
	reverse_proxy admin-panel:80
}
```

- [ ] **Step 2: Add the new env vars to `.env.example`**

Append to the end of `.env.example` (after the existing `S3_PUBLIC_BASE_URL=` line):

```
DOMAIN_APEX=gheychi.ir
DOMAIN_API=api.gheychi.ir
DOMAIN_PANEL=panel.gheychi.ir
DOMAIN_ADMIN=admin.gheychi.ir
ACME_EMAIL=admin@gheychi.ir
```

- [ ] **Step 3: Validate the Caddyfile's syntax**

Run: `docker run --rm -v "$(pwd)/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile`
Expected: `Valid configuration` printed, exit code 0.

- [ ] **Step 4: Full local compose smoke test**

```bash
cp .env.example .env
# edit the local copy: set DB_PASS/JWT_SECRET to any local value, leave providers on console/mock/local
docker compose -f docker-compose.prod.yml config --quiet
rm .env
```
Expected: `config --quiet` now succeeds with no warnings, confirming every `${VAR}` reference in `docker-compose.prod.yml` and the Caddyfile resolves against `.env.example`'s key set. (This test only validates variable resolution, not a live boot — the four `ghcr.io/...` images don't exist until Task 13 builds and pushes them.)

- [ ] **Step 5: Commit**

```bash
git add Caddyfile .env.example
git commit -m "feat(deploy): add Caddy reverse proxy config and domain env vars"
```

---

## Task 12: CI workflow — test job

Runs on every push and PR: backend unit + e2e (against real Postgres/Redis service containers), all three frontend unit suites, all three frontend Playwright e2e suites, and a full `pnpm build`.

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the test job**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_USER: gheychi
          POSTGRES_PASSWORD: gheychi
          POSTGRES_DB: gheychi
        ports:
          - "5544:5432"
        options: >-
          --health-cmd "pg_isready -U gheychi"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - "6381:6379"
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v6
        with:
          version: 9.15.0

      - uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Prepare Postgres databases
        env:
          PGPASSWORD: gheychi
        run: |
          psql -h localhost -p 5544 -U gheychi -d gheychi -c "CREATE EXTENSION IF NOT EXISTS postgis;"
          psql -h localhost -p 5544 -U gheychi -d postgres -c "CREATE DATABASE gheychi_test;"
          psql -h localhost -p 5544 -U gheychi -d gheychi_test -c "CREATE EXTENSION IF NOT EXISTS postgis;"

      - name: Create apps/api/.env for dev-mode servers (used by Playwright e2e)
        run: cp .env.example apps/api/.env

      - name: Backend unit tests
        run: pnpm --filter @gheychi/api test

      - name: Backend e2e tests
        run: pnpm --filter @gheychi/api test:e2e

      - name: Frontend unit/component tests
        run: |
          pnpm --filter @gheychi/user-app test
          pnpm --filter @gheychi/provider-panel test
          pnpm --filter @gheychi/admin-panel test

      - name: Install Playwright browsers
        # `playwright` isn't a root dependency (only a devDependency of the three frontend
        # workspaces), so `pnpm exec` needs a --filter to find the binary. The downloaded
        # browser cache is shared across all three apps regardless of which filter installs it.
        run: pnpm --filter @gheychi/user-app exec playwright install --with-deps chromium

      - name: user-app Playwright e2e
        run: pnpm --filter @gheychi/user-app test:e2e

      - name: provider-panel Playwright e2e
        run: pnpm --filter @gheychi/provider-panel test:e2e

      - name: admin-panel Playwright e2e
        run: pnpm --filter @gheychi/admin-panel test:e2e

      - name: Build all apps
        run: pnpm build
```

`DB_PORT=5544`/`REDIS_PORT=6381` are already `apps/api/.env.test`'s defaults (committed to the repo) and `.env.example`'s defaults — mapping the service containers to those exact host ports means neither file needs any CI-specific override. The three Playwright `webServer` configs each set `reuseExistingServer: !process.env.CI` and spawn their own `pnpm --filter @gheychi/api dev` — GitHub Actions sets `CI=true` automatically, so `reuseExistingServer` evaluates to `false` and each suite gets a fresh API dev server. Their `global-setup.ts` files reset the `gheychi` database (not `gheychi_test`) and run migrations against it themselves — the "Prepare Postgres databases" step above only needs to create the two empty databases with the PostGIS extension; schema and seed data are handled per-suite.

- [ ] **Step 2: Open a PR to verify the workflow runs**

```bash
git checkout -b ci-verify-plan-9
git add .github/workflows/ci.yml
git commit -m "ci: add test workflow (unit, e2e, Playwright, build)"
git push -u origin ci-verify-plan-9
```

Then open a PR (`gh pr create --title "ci: verify Plan 9 test workflow" --body "Verifying the new CI workflow runs green before continuing Plan 9."`) and watch the Actions tab.
Expected: the `test` job runs all steps and finishes green. If it fails, fix the workflow on this branch, push again, and re-check before continuing — every subsequent task in this plan depends on this job passing on `main`.

- [ ] **Step 3: Merge and clean up**

Once green, merge the PR to `main` (`gh pr merge --squash` or via the GitHub UI) and delete the branch. Continue the rest of this plan from a fresh `main` checkout.

---

## Task 13: CI workflow — build-and-push job

On `main` only, after `test` passes: build the four production images and push them to GHCR.

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the build-and-push job**

Append to the end of `.github/workflows/ci.yml` (same indentation level as the existing `test:` job, under `jobs:`):

```yaml

  build-and-push:
    needs: test
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v6

      - name: Lowercase the GHCR image owner
        run: echo "OWNER_LC=$(echo '${{ github.repository_owner }}' | tr '[:upper:]' '[:lower:]')" >> "$GITHUB_ENV"

      - uses: docker/setup-buildx-action@v4

      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push api
        uses: docker/build-push-action@v7
        with:
          context: .
          file: apps/api/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ env.OWNER_LC }}/gheychi-api:${{ github.sha }}
            ghcr.io/${{ env.OWNER_LC }}/gheychi-api:latest

      - name: Build and push user-app
        uses: docker/build-push-action@v7
        with:
          context: .
          file: apps/user-app/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ env.OWNER_LC }}/gheychi-user-app:${{ github.sha }}
            ghcr.io/${{ env.OWNER_LC }}/gheychi-user-app:latest

      - name: Build and push provider-panel
        uses: docker/build-push-action@v7
        with:
          context: .
          file: apps/provider-panel/Dockerfile
          push: true
          build-args: |
            VITE_API_BASE=${{ vars.VITE_API_BASE_PROD }}
          tags: |
            ghcr.io/${{ env.OWNER_LC }}/gheychi-provider-panel:${{ github.sha }}
            ghcr.io/${{ env.OWNER_LC }}/gheychi-provider-panel:latest

      - name: Build and push admin-panel
        uses: docker/build-push-action@v7
        with:
          context: .
          file: apps/admin-panel/Dockerfile
          push: true
          build-args: |
            VITE_API_BASE=${{ vars.VITE_API_BASE_PROD }}
          tags: |
            ghcr.io/${{ env.OWNER_LC }}/gheychi-admin-panel:${{ github.sha }}
            ghcr.io/${{ env.OWNER_LC }}/gheychi-admin-panel:latest
```

No SSH key, no VPS credentials, no Zarinpal/Kavenegar/S3 secrets anywhere in this job — it only ever touches `secrets.GITHUB_TOKEN` (built-in, scoped to this repo's GHCR packages) and the one non-secret `vars.VITE_API_BASE_PROD` repository variable.

- [ ] **Step 2: Define the `VITE_API_BASE_PROD` repository variable**

In the GitHub repo settings: **Settings → Secrets and variables → Actions → Variables tab → New repository variable**, name `VITE_API_BASE_PROD`, value `https://api.gheychi.ir/api` (or whatever `DOMAIN_API` is actually set to in Task 11's deployed `.env`). This is a manual one-time setup step — it isn't something a commit can create.

- [ ] **Step 3: Commit and push directly to `main`**

This step only edits the workflow file — commit it like any other change and push to `main` (or via a PR, per your normal review preference):

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build and push production images to GHCR on main"
git push
```

- [ ] **Step 4: Verify the job runs and produces images**

Watch the Actions tab for the push-to-`main` run. Expected: `test` passes, then `build-and-push` runs and completes. Confirm all four images exist: repo → **Packages** (right sidebar) should list `gheychi-api`, `gheychi-user-app`, `gheychi-provider-panel`, `gheychi-admin-panel`, each with a `:latest` and a `:<sha>` tag.

---

## Task 14: `docs/deployment/DEPLOY.md`

**Files:**
- Create: `docs/deployment/DEPLOY.md`

- [ ] **Step 1: Write the deployment runbook**

Create `docs/deployment/DEPLOY.md`:

```markdown
# Deploying Gheychi to Production

One Linux VPS running the four app images (built by CI, pulled from GHCR — never built on the server) plus Postgres, Redis, and a Caddy reverse proxy, all via `docker-compose.prod.yml`. See `docs/superpowers/specs/2026-07-11-plan-9-production-deployment-design.md` for the full rationale behind every decision below.

## One-time VPS setup

1. Install Docker Engine + the Compose plugin (follow Docker's official install docs for your distro).
2. Point DNS `A`/`AAAA` records for all four domains (`DOMAIN_APEX` and its `www.` alias, `DOMAIN_API`, `DOMAIN_PANEL`, `DOMAIN_ADMIN`) at the VPS's IP. Caddy cannot issue certificates until this resolves.
3. Create a deploy directory and copy three files into it from this repo: `docker-compose.prod.yml`, `Caddyfile`, and a `.env` you create from `.env.example` — **fill in real values**, especially `DB_PASS`, `JWT_SECRET`, the four `DOMAIN_*` vars, `ACME_EMAIL`, and (per the provider cutover checklist below) the real SMS/payment/storage/push credentials once you're ready to go live with them.
4. `docker login ghcr.io -u <your-github-username>` with a GitHub personal access token that has `read:packages` scope, so the VPS can pull the private images CI pushed.

## Routine deploy

From the deploy directory:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

If the deploy includes a new database migration, run it once the `api` container is up:

```bash
docker compose -f docker-compose.prod.yml exec api pnpm migration:run
```

This is a manual step by design — migrations never run automatically on container start, so an unreviewed schema change can't fire on every restart.

## Rollback

Re-run `up -d` after pointing the relevant image tag(s) in `docker-compose.prod.yml` back at a previous `:<git-sha>` tag instead of `:latest`, then `docker compose -f docker-compose.prod.yml up -d <service>`.

## Provider cutover checklist

The API ships with console/mock/local defaults so it runs with zero external credentials. Flip these `.env` values on the VPS to go live with real providers — no code changes needed, every implementation already exists and is unit-tested:

| Concern | Env vars |
|---|---|
| SMS (Kavenegar) | `SMS_PROVIDER=kavenegar`, `KAVENEGAR_API_KEY`, `KAVENEGAR_OTP_TEMPLATE` |
| Payments (Zarinpal) | `PAYMENT_GATEWAY=zarinpal`, `ZARINPAL_MERCHANT_ID` |
| Storage (S3-compatible) | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` |
| Push (Web Push) | `PUSH_PROVIDER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — generate a keypair with `npx web-push generate-vapid-keys` and also set the public half as `NUXT_PUBLIC_VAPID_PUBLIC_KEY` |

After changing any of these, `docker compose -f docker-compose.prod.yml up -d api` (and `user-app` for the VAPID public key) to apply — no rebuild needed, these are all runtime env vars.

### Manual smoke test after cutover

Real third-party credentials can't be exercised in CI — run these by hand once, in order:

1. Request an OTP for a real phone number through the login flow and confirm the SMS arrives.
2. Complete one real (small-amount or sandbox) Zarinpal payment through a booking and confirm the callback lands on the success page.
3. Upload a salon photo or blog cover image as a provider/admin and confirm the returned URL resolves publicly.
4. Subscribe to push notifications in a browser and trigger one (e.g. a booking confirmation) to confirm delivery.

## Changing the API base URL

`provider-panel` and `admin-panel` bake `VITE_API_BASE` into their static bundle at *build* time (it's a public URL, not a secret). Changing it requires a new CI build+push — update the `VITE_API_BASE_PROD` repository variable and re-run the workflow (e.g. push an empty commit to `main`), then redeploy. A VPS-side `.env` edit alone won't affect these two apps.
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment/DEPLOY.md
git commit -m "docs: add production deployment runbook"
```

---

## Task 15: Document Plan 9 in `CLAUDE.md` and `README.md`

**Files:**
- Modify: `CLAUDE.md:258-270` (Known Gaps section)
- Modify: `README.md` (append after line 165)

- [ ] **Step 1: Add a Known Gaps bullet to `CLAUDE.md`**

In `CLAUDE.md`, add a new bullet immediately after the existing line that starts with `- **No real payment refunds**, and no real alerting...` (currently the last line of the Known Gaps section):

```markdown
- **Production deployment shipped in Plan 9.** Docker images for all four apps (`Dockerfile` per app, `turbo prune --docker` multi-stage builds), a `docker-compose.prod.yml` adding Caddy (automatic HTTPS) plus the four app containers to Postgres/Redis, and a GitHub Actions workflow that runs the full test suite on every push/PR and builds+pushes images to GHCR on `main`. Deploying those images to the VPS stays a manual `docker compose pull && up -d` step — see `docs/deployment/DEPLOY.md`. **No database backup automation** — flagged as an immediate next follow-up, not part of this plan's scope. The `api` production image deliberately keeps devDependencies and full source (not just `dist/`) so the existing `pnpm migration:run` script works unchanged via `docker compose exec` — a size/simplicity tradeoff, not an oversight.
```

- [ ] **Step 2: Add a Production Deployment section to `README.md`**

Append to the end of `README.md` (after the existing last line, the "Storage best-effort deletes..." sentence closing the Plan 8 section):

```markdown

## Production deployment (Plan 9)

One VPS running `docker-compose.prod.yml`: the four app images (built and pushed to GHCR by CI, never built on the server), Postgres, Redis, and a Caddy reverse proxy with automatic HTTPS. Full runbook, provider cutover checklist, and rollback steps: `docs/deployment/DEPLOY.md`. Design rationale: `docs/superpowers/specs/2026-07-11-plan-9-production-deployment-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: record Plan 9 production deployment in CLAUDE.md and README"
```

---

## Final Verification

- [ ] Run the full local test suite one more time to confirm nothing in Tasks 1–4 regressed anything: `pnpm test` (all apps, via Turborepo)
- [ ] Confirm `docker compose -f docker-compose.prod.yml config --quiet` succeeds against a `.env` copied from the now-final `.env.example`
- [ ] Confirm the `.github/workflows/ci.yml` `test` job is green on the current `main` HEAD (Actions tab)
- [ ] Confirm all four GHCR packages exist with a `:latest` tag matching the current `main` HEAD's commit SHA

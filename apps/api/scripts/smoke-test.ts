/**
 * Post-deploy smoke test -- run by hand (or eventually from a deploy pipeline) after
 * `docker compose up -d` to verify the live site actually works end-to-end, not just that
 * every container reports healthy. Container healthchecks only prove a process is alive and
 * listening; they say nothing about whether requests flowing through the real stack (Caddy
 * -> api, real body parsing, real DTO validation) behave correctly.
 *
 * Written directly in response to a real incident: a body-parser registration bug silently
 * broke JSON parsing for every route except the one it was scoped to, for ~50 minutes in
 * production, before being caught (see apps/api/test/body-parser-registration.e2e-spec.ts
 * for the underlying bug and its own regression test). Every container reported healthy the
 * entire time -- `GET /api/health` doesn't touch a JSON request body at all, so it can't
 * have caught this. check 'unscoped JSON body parsing' below exists specifically to make
 * that exact incident irreproducible without a human noticing within seconds of running this.
 *
 * Deliberately avoids any side-effecting third-party action (no real OTP SMS, no real
 * payment) -- see docs/deployment/DEPLOY.md's "Manual smoke test after cutover" section for
 * that already-existing, explicitly one-time-only checklist. Every check here is safe to run
 * after every single deploy, as many times as needed, with zero side effects.
 */

export interface SmokeCheck {
  name: string;
  run: (urls: TargetUrls) => Promise<void>;
}

export interface TargetUrls {
  apex: string;
  api: string;
  panel: string;
  admin: string;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  error?: string;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function assertCspHeader(url: string): Promise<void> {
  const res = await fetch(url);
  const header = res.headers.get('content-security-policy-report-only');
  assert(header !== null && header.length > 0, `expected a Content-Security-Policy-Report-Only header on ${url}, got none`);
}

export const CHECKS: SmokeCheck[] = [
  {
    name: 'api health',
    run: async (urls) => {
      const { status, body } = await fetchJson(`${urls.api}/api/health`);
      assert(status === 200, `expected 200, got ${status}`);
      const b = body as { status?: string; db?: string; redis?: string };
      assert(b.status === 'ok' && b.db === 'ok' && b.redis === 'ok', `expected all-ok health body, got ${JSON.stringify(body)}`);
    },
  },
  {
    name: 'api version reports a real deploy identity',
    run: async (urls) => {
      const { status, body } = await fetchJson(`${urls.api}/api/version`);
      assert(status === 200, `expected 200, got ${status}`);
      const b = body as { version?: string; gitSha?: string };
      assert(typeof b.version === 'string' && b.version.length > 0, `expected a non-empty version, got ${JSON.stringify(body)}`);
      assert(typeof b.gitSha === 'string' && b.gitSha !== 'unknown', `expected a real gitSha, got ${JSON.stringify(body)}`);
    },
  },
  {
    name: 'api categories list',
    run: async (urls) => {
      const { status, body } = await fetchJson(`${urls.api}/api/categories`);
      assert(status === 200 && Array.isArray(body), `expected a 200 array, got ${status} ${JSON.stringify(body)}`);
    },
  },
  {
    name: 'api cities list',
    run: async (urls) => {
      const { status, body } = await fetchJson(`${urls.api}/api/cities`);
      assert(status === 200 && Array.isArray(body), `expected a 200 array, got ${status} ${JSON.stringify(body)}`);
    },
  },
  {
    name: 'unscoped JSON body parsing (the exact incident this test exists for)',
    run: async (urls) => {
      // POST /api/auth/verify-otp never sends an SMS or has any side effect on its own --
      // it only ever checks a code against Redis. A too-short `code` triggers class-
      // validator's @Length(6,6), whose message is distinguishable from what an entirely
      // MISSING body would produce (@IsString() failing on `undefined` instead) -- so this
      // genuinely proves the request body was parsed into a real object with the given
      // fields, not just that SOME 400 came back. See body-parser-registration.e2e-spec.ts
      // for why an invalid-but-plausible value, not a garbage field, is what actually
      // discriminates "parsed" from "silently missing" here.
      const { status, body } = await fetchJson(`${urls.api}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '09121234567', code: '12' }),
      });
      assert(status === 400, `expected 400, got ${status}`);
      const messages = (body as { message?: string[] }).message ?? [];
      const hasLengthError = messages.some((m) => m.toLowerCase().includes('longer than or equal to 6'));
      assert(
        hasLengthError,
        `expected a code-length validation error (proving the body was actually parsed), got ${JSON.stringify(body)} -- if this instead complains "code must be a string", req.body came back empty/undefined and the unscoped JSON parser is broken again`,
      );
    },
  },
  {
    name: 'csp-report collector (the path-scoped JSON parser)',
    run: async (urls) => {
      const res = await fetch(`${urls.api}/api/csp-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/csp-report' },
        body: JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src' } }),
      });
      assert(res.status === 204, `expected 204, got ${res.status}`);
    },
  },
  { name: 'user-app responds', run: async (urls) => assert((await fetch(urls.apex)).status === 200, 'user-app did not return 200') },
  { name: 'provider-panel responds', run: async (urls) => assert((await fetch(urls.panel)).status === 200, 'provider-panel did not return 200') },
  { name: 'admin-panel responds', run: async (urls) => assert((await fetch(urls.admin)).status === 200, 'admin-panel did not return 200') },
  { name: 'CSP header on user-app', run: async (urls) => assertCspHeader(urls.apex) },
  { name: 'CSP header on api', run: async (urls) => assertCspHeader(`${urls.api}/api/health`) },
  { name: 'CSP header on provider-panel', run: async (urls) => assertCspHeader(urls.panel) },
  { name: 'CSP header on admin-panel', run: async (urls) => assertCspHeader(urls.admin) },
];

export async function runSmokeTest(urls: TargetUrls, checks: SmokeCheck[] = CHECKS): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      await check.run(urls);
      results.push({ name: check.name, ok: true });
    } catch (err) {
      results.push({ name: check.name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

export function defaultTargetUrls(env: NodeJS.ProcessEnv): TargetUrls {
  const apex = env.SMOKE_TEST_APEX_URL ?? 'https://gheychi.co';
  const api = env.SMOKE_TEST_API_URL ?? 'https://api.gheychi.co';
  const panel = env.SMOKE_TEST_PANEL_URL ?? 'https://panel.gheychi.co';
  const admin = env.SMOKE_TEST_ADMIN_URL ?? 'https://admin.gheychi.co';
  return { apex, api, panel, admin };
}

async function main(): Promise<void> {
  const urls = defaultTargetUrls(process.env);
  console.log(`Smoke testing: apex=${urls.apex} api=${urls.api} panel=${urls.panel} admin=${urls.admin}`);
  const results = await runSmokeTest(urls);
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.error ? ` -- ${r.error}` : ''}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

import { execFileSync } from 'child_process';
import { join } from 'path';

/**
 * This deliberately does NOT `import './tracing'` directly into this jest worker.
 * tracing.ts's entire job is to monkey-patch the process-global 'http'/'pg'/'ioredis'
 * modules and register a global OTel TracerProvider (see its own doc comment) -- both are
 * genuinely process-wide, not scoped to jest's per-file module registry, so importing it
 * here would silently leave every OTHER spec file that happens to share this jest
 * worker's process instrumented (and console-logging spans) for the rest of the worker's
 * run. A real child process gives a clean, disposable process to boot the SDK in, which
 * is also a closer match to how tracing.ts actually runs in production (as the first
 * thing main.ts imports, in its own fresh process) than importing it in-process ever
 * could be.
 */
describe('tracing bootstrap', () => {
  it('initializes the OpenTelemetry SDK and shuts it down without throwing', () => {
    const output = execFileSync(
      process.execPath,
      [
        '-r',
        'ts-node/register/transpile-only',
        '-e',
        `
        const { sdk } = require('./src/tracing');
        sdk.shutdown()
          .then(() => { console.log('TRACING_SMOKE_CHECK_OK'); process.exit(0); })
          .catch((err) => { console.error(err); process.exit(1); });
        `,
      ],
      { cwd: join(__dirname, '..'), encoding: 'utf-8', timeout: 20_000 },
    );

    expect(output).toContain('TRACING_SMOKE_CHECK_OK');
  });
});

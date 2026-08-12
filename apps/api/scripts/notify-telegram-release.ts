import 'dotenv/config';
import { formatIranDateTimeFa } from '../src/common/iran-time.util';

/**
 * Posts a "release deployed" notification to a Telegram chat via the Bot API.
 *
 * Invocation (see package.json "notify-telegram-release"):
 *   ts-node scripts/notify-telegram-release.ts --version v1.2.0 --from <git-ref> --to <git-ref> [--environment Production]
 *
 * This script is meant to be run BY A HUMAN, once, immediately after they have manually
 * confirmed a successful deploy + smoke test per the deploy runbook. It does not itself
 * verify that the deploy succeeded -- the "✅ Deployed" status in the message is reporting
 * the operator's own confirmation, not something this script measured.
 *
 * No idempotency-key / "already sent" state store on purpose: because sending is a manual,
 * one-shot human action tied to a single deploy (not something CI retries or something that
 * can double-fire on its own), duplicate-prevention is a process concern -- "don't run this
 * command twice for the same release" -- not something worth a state file and the extra
 * failure modes (stale lock, concurrent-run races, cleanup) that would come with it.
 *
 * MOST IMPORTANT PROPERTY: a failed Telegram notification MUST NOT fail the deployment.
 * Every failure path here (feature disabled, missing config, network error, Telegram API
 * error, timeout) is caught and logged to stderr, and the CLI entry point always exits 0.
 * The one thing that is allowed to throw is `sendReleaseNotification`'s *construction* of
 * bad input (e.g. missing --version) at parse time, which is a usage error, not a delivery
 * failure -- see `main()`.
 */

const TELEGRAM_MESSAGE_LIMIT = 4096;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 3_000]; // up to 2 retries after the first attempt

export interface ReleaseInfo {
  version: string;
  fromRef: string;
  toRef: string;
  environment: string;
  commitSha: string;
  migrationCount: number;
  changelog: ChangelogEntry[];
  deployedAt: Date;
}

export interface ChangelogEntry {
  category: string;
  subject: string;
}

export interface TelegramEnvConfig {
  enabled: boolean;
  botToken: string | undefined;
  chatId: string | undefined;
}

/** Reads and interprets the three env vars this script cares about. Pure, no I/O. */
export function readTelegramEnvConfig(env: NodeJS.ProcessEnv): TelegramEnvConfig {
  return {
    enabled: env.TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED === 'true',
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
  };
}

/**
 * Escapes the characters Telegram's HTML parse_mode treats specially. Per Telegram's docs,
 * only &, <, > need escaping in text nodes (unlike full HTML there is no need to escape
 * quotes outside of attribute values, and we never emit attributes with dynamic content).
 */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CATEGORY_EMOJI: Record<string, string> = {
  Security: '🔒',
  Features: '✨',
  Fixes: '🐛',
  Improvements: '🔧',
  Chores: '🔧',
  Other: '📦',
};

/**
 * Builds the categorized changelog lines as HTML, e.g.:
 *   <b>✨ Features</b>
 *   • Add provider payout export
 *
 * Kept separate from truncation: this always renders the FULL changelog, and
 * `truncateToLimit` below decides how much of it survives the 4096-char budget.
 */
function renderChangelogSection(entries: ChangelogEntry[]): string {
  if (entries.length === 0) {
    return '<i>No changes recorded.</i>';
  }
  const byCategory = new Map<string, string[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(escapeTelegramHtml(entry.subject));
    byCategory.set(entry.category, list);
  }
  const blocks: string[] = [];
  for (const [category, subjects] of byCategory) {
    const emoji = CATEGORY_EMOJI[category] ?? '📦';
    const lines = subjects.map((s) => `• ${s}`).join('\n');
    blocks.push(`<b>${emoji} ${escapeTelegramHtml(category)}</b>\n${lines}`);
  }
  return blocks.join('\n\n');
}

/**
 * Renders the full HTML message: header + metadata (never truncated) followed by the
 * changelog section (truncated if needed to stay under Telegram's 4096-char limit).
 */
export function formatReleaseMessage(release: ReleaseInfo): string {
  const header = [
    `🚀 <b>New Release Deployed</b>`,
    ``,
    `<b>Version:</b> ${escapeTelegramHtml(release.version)}`,
    `<b>Environment:</b> ${escapeTelegramHtml(release.environment)}`,
    `<b>Status:</b> ✅ Deployed`,
    `<b>Date:</b> ${formatIranDateTimeFa(release.deployedAt)}`,
    `<b>Commit:</b> <code>${escapeTelegramHtml(release.commitSha)}</code>`,
    release.migrationCount > 0
      ? `<b>Migrations:</b> ${release.migrationCount} applied`
      : `<b>Migrations:</b> none`,
    ``,
    `<b>Changelog (${escapeTelegramHtml(release.fromRef)} → ${escapeTelegramHtml(release.toRef)}):</b>`,
  ].join('\n');

  const changelogHtml = renderChangelogSection(release.changelog);
  const full = `${header}\n${changelogHtml}`;
  if (full.length <= TELEGRAM_MESSAGE_LIMIT) {
    return full;
  }
  return truncateChangelog(header, release.changelog, changelogHtml);
}

/**
 * Truncates only the changelog section (never the header) to fit Telegram's message-length
 * limit. Works by re-rendering the FULL grouped changelog for progressively smaller entry
 * prefixes (largest first) until the result -- including the "N more changes" marker --
 * fits the remaining budget. Because each candidate is always a complete, independently
 * rendered set of whole entries (never a substring cut out of a longer render), we can
 * never end up mid-tag or mid-word: every candidate starts and ends on a full HTML tag
 * boundary by construction, same as `renderChangelogSection` itself.
 */
function truncateChangelog(header: string, entries: ChangelogEntry[], fullChangelogHtml: string): string {
  const budget = TELEGRAM_MESSAGE_LIMIT - header.length - 1; /* \n joining header+body */
  const marker = (omitted: number) => `\n\n<i>... (${omitted} more changes)</i>`;

  for (let included = entries.length; included >= 0; included--) {
    const omitted = entries.length - included;
    const body = included > 0 ? renderChangelogSection(entries.slice(0, included)) : '';
    const candidate = omitted > 0 ? `${body}${marker(omitted)}` : body || fullChangelogHtml;
    if (candidate.length <= budget) {
      return `${header}\n${candidate}`;
    }
  }
  // Even omitting every entry doesn't fit (pathological: header alone is already huge) --
  // best effort, still never touches the header.
  return `${header}\n${marker(entries.length)}`;
}

interface SendResult {
  ok: boolean;
  reason?: string;
}

/**
 * POSTs the message to Telegram's Bot API. Retries up to 2 times (short backoff) on network
 * failure or a 5xx response; a 4xx (bad token/chat id, bad request) is not retried -- the
 * exact response body is logged so the operator can fix config, but retrying can't help.
 *
 * Never throws. Every outcome (success, 4xx, 5xx after retries exhausted, network error,
 * timeout) resolves to a `SendResult`; the caller decides how to log it.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  deps: { fetchFn?: typeof fetch; delayFn?: (ms: number) => Promise<void> } = {},
): Promise<SendResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const delayFn = deps.delayFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const attempts = RETRY_DELAYS_MS.length + 1;
  let lastReason = 'unknown error';

  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        return { ok: true };
      }

      const bodyText = await response.text().catch(() => '<unreadable response body>');
      if (response.status >= 400 && response.status < 500) {
        // Bad token / bad chat id / malformed request -- retrying will not help.
        return { ok: false, reason: `Telegram API rejected the request (HTTP ${response.status}): ${bodyText}` };
      }
      // 5xx -- worth a retry.
      lastReason = `Telegram API returned HTTP ${response.status}: ${bodyText}`;
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      lastReason = isAbort
        ? `request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `network error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const isLastAttempt = attempt === attempts - 1;
    if (!isLastAttempt) {
      await delayFn(RETRY_DELAYS_MS[attempt]);
    }
  }

  return { ok: false, reason: lastReason };
}

/**
 * Core orchestration: decide whether to send, build the message, send it, log the outcome.
 * NEVER throws and NEVER returns a signal that should cause a non-zero process exit -- a
 * failed/misconfigured Telegram notification must not fail the deploy that triggered it.
 * The CLI entry point below is the only place that touches process.exit, and it always
 * exits 0 after calling this.
 */
export async function sendReleaseNotification(
  release: ReleaseInfo,
  env: NodeJS.ProcessEnv,
  deps: { fetchFn?: typeof fetch; delayFn?: (ms: number) => Promise<void>; log?: typeof console.log; errorLog?: typeof console.error } = {},
): Promise<void> {
  const log = deps.log ?? console.log;
  const errorLog = deps.errorLog ?? console.error;
  const config = readTelegramEnvConfig(env);

  if (!config.enabled) {
    log('[notify-telegram-release] TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED is not "true" -- skipping notification.');
    return;
  }

  if (!config.botToken || !config.chatId) {
    const missing = [
      !config.botToken ? 'TELEGRAM_BOT_TOKEN' : null,
      !config.chatId ? 'TELEGRAM_CHAT_ID' : null,
    ].filter(Boolean);
    // Never log the token/chat id VALUES -- only which named vars are configured/missing.
    errorLog(
      `[notify-telegram-release] Notifications are enabled but missing env var(s): ${missing.join(', ')}. Skipping notification (this does not fail the deploy).`,
    );
    return;
  }

  const text = formatReleaseMessage(release);
  log('[notify-telegram-release] Sending release notification to Telegram...');

  try {
    const result = await sendTelegramMessage(config.botToken, config.chatId, text, {
      fetchFn: deps.fetchFn,
      delayFn: deps.delayFn,
    });
    if (result.ok) {
      log('[notify-telegram-release] Telegram notification sent successfully.');
    } else {
      // Token itself is never included in `result.reason` -- sendTelegramMessage only ever
      // surfaces HTTP status/body text and generic network/timeout descriptions.
      errorLog(`[notify-telegram-release] Failed to send Telegram notification: ${result.reason}`);
    }
  } catch (err) {
    // Defense in depth: sendTelegramMessage is designed to never throw, but if it (or a
    // future change to it) somehow does, we still must not let that escape as a failure.
    errorLog(
      `[notify-telegram-release] Unexpected error while sending Telegram notification: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---- CLI wiring (I/O at the edges) -----------------------------------------------------

interface CliArgs {
  version: string;
  from: string;
  to: string;
  environment: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const version = get('--version');
  const from = get('--from');
  const to = get('--to');
  const environment = get('--environment') ?? 'Production';
  if (!version || !from || !to) {
    throw new Error('Usage: ts-node scripts/notify-telegram-release.ts --version v1.2.0 --from <git-ref> --to <git-ref> [--environment Production]');
  }
  return { version, from, to, environment };
}

/**
 * Runs `git` always from the repo root, never from `process.cwd()` -- this script is
 * invoked via its package.json entry with cwd=apps/api (like every other script in this
 * package), but `countMigrations` below needs the repo-root-relative pathspec
 * "apps/api/src/migrations/" that `generate-changelog.ts`'s countMigrationFiles() expects,
 * and that pathspec is only correct when git itself runs from the repo root. Resolved once
 * lazily (not module-scope) so importing this file for its pure functions in tests never
 * shells out.
 */
let cachedRepoRoot: string | undefined;
function repoRoot(): string {
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  if (!cachedRepoRoot) {
    cachedRepoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  }
  return cachedRepoRoot;
}

function git(command: string): string {
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  return execSync(`git ${command}`, { cwd: repoRoot(), encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }).trim();
}

/** Resolves `ref` to its real 7-char short SHA via git, rather than naively slicing the ref
 * string itself -- `--to` is very often a branch name (e.g. "main") or a tag, not a SHA. */
function shortSha(ref: string): string {
  try {
    return git(`rev-parse --short=7 ${ref}`);
  } catch {
    // Fall back to a best-effort slice if git can't resolve it (e.g. bad ref) -- this must
    // never throw, since a cosmetic display field is not worth failing the notification.
    return ref.slice(0, 7);
  }
}

const CATEGORY_HEADINGS: Record<string, string> = {
  security: 'Security',
  features: 'Features',
  fixes: 'Fixes',
  improvements: 'Improvements',
  other: 'Other',
};
// Rendering order: security and features surfaced first as the most operator-relevant
// categories, matching generate-changelog.ts's own CATEGORY_HEADINGS ordering.
const CATEGORY_ORDER = ['security', 'features', 'fixes', 'improvements', 'other'] as const;

/**
 * Builds the categorized changelog for the message body. Prefers the shared, tested
 * categorization logic in the sibling generate-changelog.ts script (buildChangelog +
 * parseGitLogOutput) -- imported lazily via require() so a missing/broken sibling module
 * can't prevent this script from loading at all, only from using the shared categorizer.
 * Falls back to a single flat "Other" bucket of raw commit subjects if that import fails
 * for any reason, so this script still works standalone per the task spec.
 */
function buildChangelogEntries(fromRef: string, toRef: string): ChangelogEntry[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const shared = require('./generate-changelog') as typeof import('./generate-changelog');
    const raw = git(`log ${fromRef}..${toRef} --pretty=format:'%H|%s|%an'`);
    const commits = shared.parseGitLogOutput(raw);
    const categorized = shared.buildChangelog(commits);
    const entries: ChangelogEntry[] = [];
    for (const key of CATEGORY_ORDER) {
      const bucket = (categorized as unknown as Record<string, { subject: string }[]>)[key] ?? [];
      for (const commit of bucket) {
        entries.push({ category: CATEGORY_HEADINGS[key], subject: commit.subject });
      }
    }
    return entries;
  } catch (err) {
    console.error(
      `[notify-telegram-release] Could not use shared changelog categorizer, falling back to a flat list: ${err instanceof Error ? err.message : String(err)}`,
    );
    try {
      const raw = git(`log --pretty=format:'%s' ${fromRef}..${toRef}`);
      return raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((subject) => ({ category: 'Other', subject }));
    } catch {
      return [];
    }
  }
}

function countMigrations(fromRef: string, toRef: string): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const shared = require('./generate-changelog') as typeof import('./generate-changelog');
    const raw = git(`diff --name-only ${fromRef}..${toRef} -- apps/api/src/migrations/`);
    const paths = raw.split('\n').filter((line) => line.trim().length > 0);
    return shared.countMigrationFiles(paths);
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const release: ReleaseInfo = {
    version: args.version,
    fromRef: args.from,
    toRef: args.to,
    environment: args.environment,
    commitSha: shortSha(args.to),
    migrationCount: countMigrations(args.from, args.to),
    changelog: buildChangelogEntries(args.from, args.to),
    deployedAt: new Date(),
  };

  await sendReleaseNotification(release, process.env);
}

if (require.main === module) {
  main()
    .catch((err: unknown) => {
      // Only reachable for usage errors thrown by parseArgs (e.g. missing --version) --
      // sendReleaseNotification itself never throws/rejects. Even here we still must not
      // fail a deploy over a notification script, but a usage error means the operator
      // typo'd the invocation and should see it.
      console.error(err instanceof Error ? err.message : err);
    })
    .finally(() => {
      // Always exit 0: this notification step must never fail the deployment, per spec.
      process.exit(0);
    });
}

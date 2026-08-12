import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

/**
 * A single commit as fetched from `git log`. Deliberately just the three fields
 * we asked git for -- no parsing of trailers, no fetching the full body. Keeping
 * this shape minimal is what lets buildChangelog() below be a pure function that
 * a sibling script (notify-telegram-release.ts) can import and reuse without
 * shelling out to git itself.
 */
export interface Commit {
  hash: string;
  subject: string;
  author: string;
}

export type ChangelogCategory = 'features' | 'fixes' | 'security' | 'improvements' | 'other';

export interface CategorizedChangelog {
  features: Commit[];
  fixes: Commit[];
  security: Commit[];
  improvements: Commit[];
  /**
   * True catch-all: anything that matched none of the keyword rules above.
   * See categorizeCommit()'s doc comment for why this is a separate bucket
   * from `improvements` rather than folded into it.
   */
  other: Commit[];
  /** Unique `%an` author names across the range, in first-seen order. */
  contributors: string[];
}

/**
 * Best-effort keyword categorization of a single commit subject line.
 *
 * This repo's commits are NOT strict Conventional Commits (confirmed by reading
 * a real sample via `git log --oneline -50`): some are prefixed
 * ("fix(admin-panel): ...", "feat(api): ..."), most are plain imperative
 * sentences ("Add standalone backup/restore verification tooling", "Fix drift
 * found in a cross-app design-consistency audit"). The rules below are tuned
 * against that real sample, not against an idealized commit-message format.
 *
 * Bucket precedence, evaluated top to bottom (first match wins):
 *   1. security     -- contains "security" / "vulnerability" / "CVE" (any case).
 *                       Checked FIRST so a commit like "fix: patch a security
 *                       vulnerability in X" surfaces under Security rather than
 *                       being swallowed by the (broader) Fixes rule.
 *   2. features      -- subject starts with "feat" or "add " (case-insensitive).
 *                       "add " (trailing space required) rather than a bare "add"
 *                       prefix, so "Address the caching bug" or "Adding a retry"
 *                       don't false-positive as features.
 *   3. fixes         -- subject starts with "fix", OR contains the standalone
 *                       word "fix" followed by ":" or whitespace anywhere in the
 *                       subject (e.g. "..., fix amount input bug", matching the
 *                       real commit 9e8e0b0 in this repo's history). The \b word
 *                       boundary keeps this from matching inside "prefix"/"suffix".
 *   4. improvements  -- subject starts with "improve" / "refactor" / "perf" /
 *                       "chore".
 *   5. other         -- everything else. See CategorizedChangelog.other's doc
 *                       comment: the task spec's own wording described
 *                       "Improvements" as *both* a specific keyword bucket AND
 *                       "a catch-all default bucket for anything not matching
 *                       the above", while separately requiring an uncategorizable
 *                       commit to land in a distinct, generic "Other changes"
 *                       bucket so nothing is silently dropped. Those two
 *                       instructions conflict if Improvements is made the
 *                       catch-all. Resolved here by keeping Improvements a
 *                       precise, keyword-matched bucket and giving "other" the
 *                       catch-all role -- every commit is still categorized
 *                       (nothing dropped), and each bucket's meaning stays
 *                       legible instead of Improvements becoming a grab-bag.
 */
export function categorizeCommit(subject: string): ChangelogCategory {
  const lower = subject.toLowerCase();

  if (lower.includes('security') || lower.includes('vulnerability') || lower.includes('cve')) {
    return 'security';
  }
  if (lower.startsWith('feat') || lower.startsWith('add ')) {
    return 'features';
  }
  if (lower.startsWith('fix') || /\bfix(:|\s)/.test(lower)) {
    return 'fixes';
  }
  if (
    lower.startsWith('improve') ||
    lower.startsWith('refactor') ||
    lower.startsWith('perf') ||
    lower.startsWith('chore')
  ) {
    return 'improvements';
  }
  return 'other';
}

/**
 * Pure categorization core. Takes already-fetched commits (no git I/O here) so
 * it's trivially unit-testable and importable by other scripts -- see
 * generate-changelog.spec.ts and apps/api/scripts/notify-telegram-release.ts.
 *
 * Contributors are just the raw `%an` git-author names, deduplicated in
 * first-seen order. This repo's commit *bodies* carry a
 * "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>" trailer on
 * AI-assisted commits (confirmed via `git log`), but that trailer lives in the
 * commit message body, not the `%an` author field `git log --pretty=%an`
 * actually returns -- so it never appears in the Commit objects this function
 * receives in the first place. Deliberately NOT parsing commit bodies to peel
 * out a separate "Claude" contributor: it would require fetching full commit
 * messages (an extra git call the CLI entry point doesn't otherwise need) and
 * trailer-parsing logic, for a cosmetic distinction the task doesn't ask this
 * function to make. Simple wins: list the author name field as-is.
 */
export function buildChangelog(commits: Commit[]): CategorizedChangelog {
  const changelog: CategorizedChangelog = {
    features: [],
    fixes: [],
    security: [],
    improvements: [],
    other: [],
    contributors: [],
  };

  const seenAuthors = new Set<string>();

  for (const commit of commits) {
    changelog[categorizeCommit(commit.subject)].push(commit);
    if (!seenAuthors.has(commit.author)) {
      seenAuthors.add(commit.author);
      changelog.contributors.push(commit.author);
    }
  }

  return changelog;
}

/**
 * Pure helper for the migration-detection piece of the spec: given a list of
 * changed file paths (as `git diff --name-only` would report them, repo-root
 * relative), count how many fall under apps/api/src/migrations/.
 *
 * Split out from the git-shelling call itself specifically so it has a pure,
 * unit-testable core -- see generate-changelog.spec.ts. The git-diff
 * invocation that PRODUCES this path list is thin (one execSync call, no
 * branching logic worth mocking child_process for) and is instead verified by
 * actually running this script against this repo's real history -- see this
 * script's own package.json entry and the task's VERIFY step.
 */
export function countMigrationFiles(changedPaths: string[]): number {
  const MIGRATIONS_DIR = 'apps/api/src/migrations/';
  return changedPaths.filter((path) => path.trim().startsWith(MIGRATIONS_DIR)).length;
}

export interface ChangelogMeta {
  from: string;
  to: string;
  migrationsChanged: number;
}

const CATEGORY_HEADINGS: Record<keyof Omit<CategorizedChangelog, 'contributors'>, string> = {
  features: 'Features',
  fixes: 'Fixes',
  security: 'Security',
  improvements: 'Improvements',
  other: 'Other changes',
};

/**
 * Renders a CategorizedChangelog to Markdown. Exported (not just used by
 * main() below) so notify-telegram-release.ts can reuse the exact same
 * rendering instead of re-implementing it or shelling out to this file.
 */
export function formatChangelogMarkdown(changelog: CategorizedChangelog, meta: ChangelogMeta): string {
  const lines: string[] = [];
  lines.push(`# Changelog: ${meta.from}..${meta.to}`);
  lines.push('');

  const totalCommits =
    changelog.features.length +
    changelog.fixes.length +
    changelog.security.length +
    changelog.improvements.length +
    changelog.other.length;
  lines.push(`${totalCommits} commit(s), ${changelog.contributors.length} contributor(s).`);
  lines.push(
    meta.migrationsChanged > 0
      ? `${meta.migrationsChanged} database migration file(s) changed in this range.`
      : 'No database migration files changed in this range.',
  );
  lines.push('');

  for (const key of Object.keys(CATEGORY_HEADINGS) as Array<keyof typeof CATEGORY_HEADINGS>) {
    const commits = changelog[key];
    if (commits.length === 0) continue;
    lines.push(`## ${CATEGORY_HEADINGS[key]}`);
    for (const commit of commits) {
      lines.push(`- ${commit.subject} (${commit.hash.slice(0, 7)}) -- ${commit.author}`);
    }
    lines.push('');
  }

  lines.push('## Contributors');
  for (const author of changelog.contributors) {
    lines.push(`- ${author}`);
  }

  return lines.join('\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// CLI entry point below. All git I/O is confined to this section so
// buildChangelog()/formatChangelogMarkdown()/countMigrationFiles() above stay
// pure and importable without a real git repo present (matches the
// require.main === module gating pattern used by scripts/create-admin.ts).
// ---------------------------------------------------------------------------

interface CliArgs {
  from?: string;
  to: string;
  output?: string;
}

const USAGE = 'Usage: ts-node scripts/generate-changelog.ts [--from <git-ref>] [--to <git-ref>] [--output <path>]';

/**
 * pnpm 9 leaks the `--` separator into forwarded script args as a literal
 * first argument, same as scripts/create-admin.ts's resolvePhoneArg -- skip
 * any bare `--` wherever it appears rather than assuming it's only ever first.
 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { to: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--from') {
      args.from = argv[++i];
    } else if (arg === '--to') {
      args.to = argv[++i];
    } else if (arg === '--output') {
      args.output = argv[++i];
    } else {
      throw new Error(`Unrecognized argument "${arg}"\n${USAGE}`);
    }
  }
  return args;
}

function git(command: string, repoRoot: string): string {
  return execSync(`git ${command}`, { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 1024 * 1024 * 64 }).trim();
}

function resolveRepoRoot(): string {
  // Run from repo root regardless of the cwd this script itself was invoked
  // from (apps/api, per its package.json entry) so pathspecs like
  // "apps/api/src/migrations/" below resolve correctly either way.
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
}

function resolveDefaultFrom(repoRoot: string): string {
  try {
    const tag = git('describe --tags --abbrev=0', repoRoot);
    if (tag) return tag;
  } catch {
    // No tags reachable from HEAD -- fall through to the repo's first commit.
  }
  const roots = git('rev-list --max-parents=0 HEAD', repoRoot)
    .split('\n')
    .filter((line) => line.trim().length > 0);
  if (roots.length === 0) {
    throw new Error('Could not resolve a default --from: no tags and no root commit found.');
  }
  // A repo can technically have multiple root commits (unrelated histories);
  // take the first one deterministically rather than erroring.
  return roots[0];
}

/**
 * Parses `git log --pretty=format:%H|%s|%an` output. Splits on the FIRST and
 * LAST "|" per line (not every "|") so a commit subject that itself contains
 * a literal pipe character doesn't get mis-split -- author names containing
 * "|" are not a real-world case worth guarding against here.
 */
export function parseGitLogOutput(raw: string): Commit[] {
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const firstPipe = line.indexOf('|');
      const lastPipe = line.lastIndexOf('|');
      return {
        hash: line.slice(0, firstPipe),
        subject: line.slice(firstPipe + 1, lastPipe),
        author: line.slice(lastPipe + 1),
      };
    });
}

function fetchCommits(from: string, to: string, repoRoot: string): Commit[] {
  // The pretty-format string is single-quoted: execSync runs this through a shell, and
  // an unquoted "|" would be interpreted as a shell pipe rather than passed to git.
  const raw = git(`log ${from}..${to} --pretty=format:'%H|%s|%an'`, repoRoot);
  return parseGitLogOutput(raw);
}

function countChangedMigrations(from: string, to: string, repoRoot: string): number {
  const raw = git(`diff --name-only ${from}..${to} -- apps/api/src/migrations/`, repoRoot);
  const paths = raw.split('\n').filter((line) => line.trim().length > 0);
  return countMigrationFiles(paths);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();
  const from = args.from ?? resolveDefaultFrom(repoRoot);
  const to = args.to;

  const commits = fetchCommits(from, to, repoRoot);
  const changelog = buildChangelog(commits);
  const migrationsChanged = countChangedMigrations(from, to, repoRoot);

  const markdown = formatChangelogMarkdown(changelog, { from, to, migrationsChanged });

  if (args.output) {
    writeFileSync(args.output, markdown, 'utf-8');
    console.log(`Wrote changelog (${commits.length} commit(s)) to ${args.output}`);
  } else {
    console.log(markdown);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : err);
    console.error(USAGE);
    process.exit(1);
  }
}

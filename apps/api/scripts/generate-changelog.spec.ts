import {
  Commit,
  buildChangelog,
  categorizeCommit,
  countMigrationFiles,
  formatChangelogMarkdown,
  parseArgs,
  parseGitLogOutput,
} from './generate-changelog';

function commit(hash: string, subject: string, author = 'AmirHo3sein'): Commit {
  return { hash, subject, author };
}

describe('categorizeCommit', () => {
  it('categorizes a conventional-prefixed feature commit', () => {
    expect(categorizeCommit('feat(api): persist analytics events, add admin aggregation endpoint')).toBe('features');
  });

  it('categorizes an unprefixed "Add ..." commit as a feature', () => {
    expect(categorizeCommit('Add standalone backup/restore verification tooling')).toBe('features');
  });

  it('does not false-positive "Add" as a feature when it is really "Address"/"Adding"', () => {
    // "Address"/"Adding" both start with the literal substring "Add" but not "add "
    // (trailing space) -- this is the exact false-positive the trailing-space
    // requirement in categorizeCommit's doc comment guards against.
    expect(categorizeCommit('Address the caching bug in the availability service')).not.toBe('features');
    expect(categorizeCommit('Adding a retry to the payment webhook')).not.toBe('features');
  });

  it('categorizes a conventional-prefixed fix commit', () => {
    expect(categorizeCommit('fix(admin-panel): wallet adjustment amount input bug')).toBe('fixes');
  });

  it('categorizes an unprefixed "Fix ..." commit as a fix', () => {
    expect(categorizeCommit('Fix drift found in a cross-app design-consistency audit')).toBe('fixes');
  });

  it('categorizes a mid-sentence ", fix ..." commit as a fix (real repo example)', () => {
    expect(categorizeCommit('test(admin-panel): wallet adjustment e2e coverage, fix amount input bug')).toBe('fixes');
  });

  it('does not false-positive the word "fix" inside "prefix"/"suffix"', () => {
    expect(categorizeCommit('Rename the prefix used for cache keys')).not.toBe('fixes');
    expect(categorizeCommit('Normalize the suffix on uploaded filenames')).not.toBe('fixes');
  });

  it('categorizes security-flavored commits regardless of case', () => {
    expect(categorizeCommit('Patch a SECURITY vulnerability in the upload handler')).toBe('security');
    expect(categorizeCommit('Address CVE-2024-1234 in a transitive dependency')).toBe('security');
    expect(categorizeCommit('fix a Vulnerability in session handling')).toBe('security');
  });

  it('gives security precedence over a "fix"-prefixed subject', () => {
    // A commit that is both a fix AND security-flavored should surface under
    // Security, not be swallowed by the broader Fixes rule.
    expect(categorizeCommit('fix: patch a security hole in the OTP endpoint')).toBe('security');
  });

  it('categorizes improvement-keyword commits', () => {
    expect(categorizeCommit('refactor: extract the availability filter into its own module')).toBe('improvements');
    expect(categorizeCommit('perf: cache the working-hours lookup')).toBe('improvements');
    expect(categorizeCommit('chore: bump typeorm')).toBe('improvements');
    expect(categorizeCommit('improve error messages on class-validator failures')).toBe('improvements');
  });

  it('falls back to "other" for a commit matching none of the keyword rules', () => {
    expect(categorizeCommit('Stop logging the raw Zarinpal payment authority in the access log')).toBe('other');
    expect(categorizeCommit('Sort the admin salon moderation queue oldest-first, not alphabetically')).toBe('other');
  });
});

describe('buildChangelog', () => {
  it('sorts commits into the right buckets and never drops one', () => {
    const commits: Commit[] = [
      commit('1111111', 'feat(api): add wallet spend at checkout'),
      commit('2222222', 'fix(admin-panel): wallet adjustment amount input bug'),
      commit('3333333', 'Patch a security vulnerability in the upload handler'),
      commit('4444444', 'refactor: extract the availability filter into its own module'),
      commit('5555555', 'Sort the admin salon moderation queue oldest-first, not alphabetically'),
    ];

    const changelog = buildChangelog(commits);

    expect(changelog.features.map((c) => c.hash)).toEqual(['1111111']);
    expect(changelog.fixes.map((c) => c.hash)).toEqual(['2222222']);
    expect(changelog.security.map((c) => c.hash)).toEqual(['3333333']);
    expect(changelog.improvements.map((c) => c.hash)).toEqual(['4444444']);
    expect(changelog.other.map((c) => c.hash)).toEqual(['5555555']);

    const totalBucketed =
      changelog.features.length +
      changelog.fixes.length +
      changelog.security.length +
      changelog.improvements.length +
      changelog.other.length;
    expect(totalBucketed).toBe(commits.length);
  });

  it('deduplicates contributors in first-seen order without dropping any commit', () => {
    const commits: Commit[] = [
      commit('1111111', 'feat: a', 'Alice'),
      commit('2222222', 'fix: b', 'Bob'),
      commit('3333333', 'chore: c', 'Alice'),
    ];

    const changelog = buildChangelog(commits);

    expect(changelog.contributors).toEqual(['Alice', 'Bob']);
  });

  it('returns empty buckets and no contributors for an empty commit range', () => {
    const changelog = buildChangelog([]);
    expect(changelog).toEqual({
      features: [],
      fixes: [],
      security: [],
      improvements: [],
      other: [],
      contributors: [],
    });
  });
});

describe('countMigrationFiles', () => {
  // The git-diff invocation that PRODUCES this path list is a single, thin execSync
  // call with no branching logic of its own (see generate-changelog.ts's doc comment
  // on countMigrationFiles) -- covered by running the script for real against this
  // repo's history rather than mocking child_process here. This unit-tests just the
  // pure filtering/counting logic on a hand-built path list.
  it('counts only files under apps/api/src/migrations/', () => {
    const paths = [
      'apps/api/src/migrations/1700000000000-add-index.ts',
      'apps/api/src/migrations/1700000001000-add-column.ts',
      'apps/api/src/users/user.entity.ts',
      'apps/user-app/pages/index.vue',
    ];
    expect(countMigrationFiles(paths)).toBe(2);
  });

  it('returns 0 when no migration files changed', () => {
    expect(countMigrationFiles(['apps/api/src/users/user.entity.ts'])).toBe(0);
  });

  it('returns 0 for an empty change list', () => {
    expect(countMigrationFiles([])).toBe(0);
  });
});

describe('parseGitLogOutput', () => {
  it('parses hash|subject|author lines', () => {
    const raw = [
      'aaaaaaa1|feat(api): add wallet spend at checkout|AmirHo3sein',
      'bbbbbbb2|fix(admin-panel): wallet adjustment amount input bug|AmirHo3sein',
    ].join('\n');

    expect(parseGitLogOutput(raw)).toEqual([
      commit('aaaaaaa1', 'feat(api): add wallet spend at checkout'),
      commit('bbbbbbb2', 'fix(admin-panel): wallet adjustment amount input bug'),
    ]);
  });

  it('splits on the first and last "|" so a subject containing "|" survives intact', () => {
    const raw = 'aaaaaaa1|fix: handle a|b edge case in the parser|AmirHo3sein';
    expect(parseGitLogOutput(raw)).toEqual([commit('aaaaaaa1', 'fix: handle a|b edge case in the parser')]);
  });

  it('ignores blank lines', () => {
    const raw = '\naaaaaaa1|feat: a|Alice\n\n';
    expect(parseGitLogOutput(raw)).toEqual([commit('aaaaaaa1', 'feat: a', 'Alice')]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseGitLogOutput('')).toEqual([]);
  });
});

describe('formatChangelogMarkdown', () => {
  it('renders headings only for non-empty buckets and lists all contributors', () => {
    const changelog = buildChangelog([
      commit('1111111', 'feat: add wallet spend at checkout', 'Alice'),
      commit('2222222', 'fix: wallet adjustment amount input bug', 'Bob'),
    ]);

    const markdown = formatChangelogMarkdown(changelog, { from: 'v1.0.0', to: 'HEAD', migrationsChanged: 0 });

    expect(markdown).toContain('# Changelog: v1.0.0..HEAD');
    expect(markdown).toContain('## Features');
    expect(markdown).toContain('## Fixes');
    expect(markdown).not.toContain('## Security');
    expect(markdown).not.toContain('## Improvements');
    expect(markdown).not.toContain('## Other changes');
    expect(markdown).toContain('No database migration files changed in this range.');
    expect(markdown).toContain('- Alice');
    expect(markdown).toContain('- Bob');
  });

  it('reports the migration count when migrations changed', () => {
    const markdown = formatChangelogMarkdown(buildChangelog([]), { from: 'a', to: 'b', migrationsChanged: 3 });
    expect(markdown).toContain('3 database migration file(s) changed in this range.');
  });
});

describe('parseArgs', () => {
  it('defaults --to to HEAD and leaves --from unset', () => {
    expect(parseArgs([])).toEqual({ to: 'HEAD' });
  });

  it('parses --from, --to, and --output', () => {
    expect(parseArgs(['--from', 'v1.0.0', '--to', 'v1.1.0', '--output', 'CHANGELOG.md'])).toEqual({
      from: 'v1.0.0',
      to: 'v1.1.0',
      output: 'CHANGELOG.md',
    });
  });

  it('skips a leaked leading "--" separator, same as create-admin.ts', () => {
    expect(parseArgs(['--', '--from', 'v1.0.0'])).toEqual({ from: 'v1.0.0', to: 'HEAD' });
  });

  it('throws on an unrecognized argument', () => {
    expect(() => parseArgs(['--bogus'])).toThrow('Unrecognized argument "--bogus"');
  });
});

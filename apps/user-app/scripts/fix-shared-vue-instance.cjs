#!/usr/bin/env node
// Some of this app's dependencies have no per-consumer peer-resolved copy of `vue` in the
// pnpm store: their own `node_modules/` under `.pnpm/<pkg>@<version>/` carries no local
// `vue`, so their bare `import 'vue'` falls through Node's directory walk-up all the way to
// pnpm's shared `.pnpm/node_modules/vue` symlink -- a SINGLE, workspace-wide fallback that
// pnpm points at whichever vue resolution it happened to elect (currently 3.5.39, matching
// admin-panel and provider-panel), regardless of which app is actually rendering the
// component. user-app resolves its own vue to 3.5.42, so a package hitting that fallback ends
// up calling into a *different* `@vue/runtime-core` instance than the one that mounted it --
// Vue's reactivity context is a module-level singleton, so this reliably breaks with
// "Missing ref owner context" / "Cannot read properties of null" (vue-multiselect, used by
// AppSelect) or "Cannot define property imgEl, object is not extensible" (@nuxt/image's
// NuxtImg, via useTemplateRef) wherever the affected component renders.
//
// Confirmed this doesn't affect admin-panel/provider-panel: their own component tests run
// through plain Vitest + Vite's normal client-bundling resolver (not Nuxt's SSR-oriented
// "nuxt" test environment user-app uses), which correctly dedupes to their own local vue and
// never touches this shared fallback at all -- verified by running both suites fully green
// after this fix.
//
// No pnpm config change (dedupe-peer-dependents=false, resolve.dedupe, resolve.alias,
// ssr.noExternal, server.deps.inline -- all tried) fixes this: the resolution happens via
// plain Node module resolution before Vite's own resolver is ever consulted, and
// dedupe-peer-dependents=false additionally destabilizes unrelated version resolution across
// the whole workspace. The reliable fix is exactly what pnpm itself would create for a
// properly peer-scoped install: a `vue` entry inside each affected package's own
// `node_modules/`, pointing at THIS app's own correctly-resolved vue. This script creates
// that symlink after every install; it is idempotent and safe to re-run. Add a package here
// only once it's actually been seen hitting this fallback (a test failure whose stack shows
// a different `@vue/runtime-core@<version>` than the rest of the trace) -- this is a
// known-affected allowlist, not a blanket "every vue-touching package" scan, since blindly
// repointing a package's shared store entry could affect another workspace app relying on the
// same fallback in a pipeline this one hasn't been verified against.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AFFECTED_PACKAGES = ['vue-multiselect', '@nuxt/image'];

function findWorkspaceRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Could not find pnpm-workspace.yaml above ' + startDir);
    dir = parent;
  }
}

// pnpm's store folder names replace a scoped package's `/` with `+`, e.g.
// `@nuxt/image@2.0.0...` lives under `.pnpm/@nuxt+image@2.0.0.../`.
function storeNamePrefix(pkgName) {
  return pkgName.replace('/', '+') + '@';
}

function main() {
  const appDir = path.resolve(__dirname, '..');
  const workspaceRoot = findWorkspaceRoot(appDir);
  const pnpmStoreDir = path.join(workspaceRoot, 'node_modules', '.pnpm');

  if (!fs.existsSync(pnpmStoreDir)) {
    console.warn('[fix-shared-vue-instance] no node_modules/.pnpm found, skipping (not a pnpm install?)');
    return;
  }

  // `vue` is only a transitive dependency of this app (pulled in by nuxt/pinia/@sentry/vue),
  // so pnpm never gives apps/user-app/node_modules its own `vue` symlink to resolve from
  // directly -- resolve it the same way Node itself would from *inside* nuxt's own install,
  // which pnpm does give a correctly peer-scoped `vue`.
  let vuePath;
  try {
    const nuxtPkgPath = require.resolve('nuxt/package.json', { paths: [appDir] });
    vuePath = path.dirname(require.resolve('vue/package.json', { paths: [path.dirname(nuxtPkgPath)] }));
  } catch (err) {
    console.warn("[fix-shared-vue-instance] could not resolve this app's own vue package, skipping:", err.message);
    return;
  }

  const storeEntries = fs.readdirSync(pnpmStoreDir);

  for (const pkgName of AFFECTED_PACKAGES) {
    const prefix = storeNamePrefix(pkgName);
    const matches = storeEntries.filter((name) => name.startsWith(prefix));
    if (matches.length === 0) {
      console.warn(`[fix-shared-vue-instance] no ${pkgName}@* found under the pnpm store, skipping`);
      continue;
    }

    for (const dirName of matches) {
      const linkPath = path.join(pnpmStoreDir, dirName, 'node_modules', 'vue');
      const linkParent = path.dirname(linkPath);
      if (!fs.existsSync(linkParent)) continue;

      const existing = fs.existsSync(linkPath) ? fs.lstatSync(linkPath) : null;
      if (existing?.isSymbolicLink() && fs.realpathSync(linkPath) === fs.realpathSync(vuePath)) {
        continue; // already correct
      }
      if (existing) fs.rmSync(linkPath, { recursive: true, force: true });

      fs.symlinkSync(path.relative(linkParent, vuePath), linkPath, 'dir');
      console.log(`[fix-shared-vue-instance] linked ${dirName}'s vue -> ${path.relative(workspaceRoot, vuePath)}`);
    }
  }
}

main();

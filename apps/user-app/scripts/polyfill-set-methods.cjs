#!/usr/bin/env node
// Node 20 (this repo's CI runner and every production Docker base image: node:20-alpine)
// has no native `Set.prototype.difference`/`union`/`intersection`/etc. -- those "Set methods"
// (TC39, Stage 4) shipped in V8 12.4, landing in Node 22.0, with no ponyfill in Node 20 at
// all. cssnano-preset-default@8.x's own postcss-merge-longhand@8.x sub-plugin calls
// `Set.prototype.difference()` unconditionally, so ANY use of cssnano under Node 20 throws
// `TypeError: trustedFunctions.difference is not a function` -- confirmed this breaks not
// just `nuxt typecheck`/tests but a real `nuxt build`, i.e. this app's actual production
// build. cssnano-preset-default's own `engines` field (`^22.11.0 || ^24.11.0 || >=26.0`)
// confirms this is deliberate on their end, not a bug to report upstream.
//
// A version-pin override (matching this repo's existing pnpm-workspace.yaml overrides
// pattern for postcss/nanoid/brace-expansion) does NOT work here: `pnpm-workspace.yaml`
// overrides for `cssnano`/`cssnano-preset-default` were silently ignored even across a full
// `rm pnpm-lock.yaml && pnpm install` -- confirmed via a deliberately-invalid override
// version causing no resolution error at all, meaning pnpm never even attempted to apply it.
// @nuxt/vite-builder appears to resolve cssnano through a runtime filesystem lookup (the
// same `exsolve`/`local-pkg`-style dynamic resolution @nuxt/test-utils itself uses
// elsewhere), not through the static, override-aware dependency graph pnpm builds from
// package.json -- the same class of "override can't reach it" gap
// scripts/fix-shared-vue-instance.cjs already documents for a different symptom.
//
// A narrow one-file patch (just postcss-merge-longhand's own offending line) would be
// whack-a-mole against the ~28 postcss-* sub-plugins cssnano-preset-default pulls in, any of
// which could start relying on another Node 22+ Set method in a future patch release. A
// global, spec-faithful polyfill of the whole proposal is the robust fix, and it's a genuine
// no-op wherever the native methods already exist (Node 22+, so this file stays safe to keep
// even after this repo's Node floor eventually moves off 20). Loaded via NODE_OPTIONS=--require
// from each package.json script that can reach cssnano (build/generate/preview/test); harmless
// to load from the others too.
'use strict';

function polyfillSetMethod(name, impl) {
  if (typeof Set.prototype[name] === 'function') return;
  Object.defineProperty(Set.prototype, name, {
    value: impl,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

polyfillSetMethod('difference', function difference(other) {
  const result = new Set(this);
  for (const value of other) result.delete(value);
  return result;
});

polyfillSetMethod('union', function union(other) {
  const result = new Set(this);
  for (const value of other) result.add(value);
  return result;
});

polyfillSetMethod('intersection', function intersection(other) {
  const result = new Set();
  for (const value of this) if (other.has(value)) result.add(value);
  return result;
});

polyfillSetMethod('symmetricDifference', function symmetricDifference(other) {
  const result = new Set(this);
  for (const value of other) {
    if (result.has(value)) result.delete(value);
    else result.add(value);
  }
  return result;
});

polyfillSetMethod('isSubsetOf', function isSubsetOf(other) {
  for (const value of this) if (!other.has(value)) return false;
  return true;
});

polyfillSetMethod('isSupersetOf', function isSupersetOf(other) {
  for (const value of other) if (!this.has(value)) return false;
  return true;
});

polyfillSetMethod('isDisjointFrom', function isDisjointFrom(other) {
  for (const value of this) if (other.has(value)) return false;
  return true;
});

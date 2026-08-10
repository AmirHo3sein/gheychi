import { SetMetadata } from '@nestjs/common';

// Read by AuthGuard (via Reflector) to skip the global auth check for a route that is
// deliberately reachable with no session at all. Applying this is a reviewable SECURITY
// DECISION, not a formality -- see route-guard-audit.spec.ts, which pins every @Public()
// route against the same allowlist this decorator used to be checked against manually.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

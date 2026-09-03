import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

const REVOKED_KEY_PREFIX = 'session:revoked:';

/**
 * Makes an individual session token revocable.
 *
 * Sessions are stateless 30-day JWTs in an HttpOnly cookie, which means that without this
 * a token copied off the wire stayed valid for up to a month and `logout` -- which only
 * cleared the cookie in the caller's own browser -- could not do anything about it. The
 * one thing that DID work was suspension: AuthGuard reloads the user on every request and
 * rejects a suspended one, so an admin has always been able to stop an account. What was
 * missing was stopping ONE session without nuking the whole account.
 *
 * Design: a denylist keyed on the token's own `jti`, not a session store. Almost every
 * request is a non-revoked session, so an allowlist would mean a Redis write per login and
 * a lookup that must succeed for anyone to use the site at all; a denylist only holds the
 * rare revoked ones, and each entry expires on its own with the token it refers to (TTL =
 * the token's remaining lifetime), so the set stays small and needs no sweeper.
 *
 * FAIL-CLOSED on a Redis outage. This is the deliberate opposite of the alert-dedup
 * fail-open convention elsewhere in this codebase, and the reason is the direction each
 * failure points: a missed alert is an operational annoyance, while treating a revoked
 * session as valid is the exact security property this class exists to provide. Redis is
 * already a hard dependency of login itself (OTP codes live there), so an outage that
 * breaks this check has already broken authentication anyway -- it cannot make the site
 * meaningfully less available than it already is.
 */
@Injectable()
export class SessionRevocationService {
  private readonly logger = new Logger('SessionRevocationService');

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Revokes one session. `expSeconds` is the JWT's own `exp` claim: the entry only needs
   * to outlive the token it blocks, and a token that has already expired needs no entry at
   * all (verifyAsync rejects it on its own).
   */
  async revoke(jti: string, expSeconds: number): Promise<void> {
    const ttlSeconds = expSeconds - Math.floor(Date.now() / 1000);
    if (ttlSeconds <= 0) return;
    await this.redis.set(REVOKED_KEY_PREFIX + jti, '1', 'EX', ttlSeconds);
  }

  /** Throws if the check cannot be performed -- see the fail-closed note on this class. */
  async isRevoked(jti: string): Promise<boolean> {
    const found = await this.redis.exists(REVOKED_KEY_PREFIX + jti);
    return found === 1;
  }
}

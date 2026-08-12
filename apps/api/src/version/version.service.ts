import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface VersionInfo {
  version: string;
  gitSha: string;
  buildTimestamp: string | null;
  environment: string;
}

// Everything here is read ONCE at construction time (a running process's build identity
// never changes mid-life) and is deliberately safe for an unauthenticated caller: no DB
// credentials, no internal paths, no secrets -- just "what code is this, and when was it
// built" for deploy verification / support triage. CI/CD sets APP_VERSION/GIT_SHA/
// BUILD_TIMESTAMP at image-build time (see root .env.example); locally they fall back to
// dev-friendly defaults so `pnpm dev` doesn't require setting them by hand.
@Injectable()
export class VersionService {
  private readonly info: VersionInfo;

  constructor(config: ConfigService) {
    this.info = {
      version: config.get<string>('APP_VERSION', 'dev'),
      gitSha: config.get<string>('GIT_SHA', 'unknown'),
      buildTimestamp: config.get<string | null>('BUILD_TIMESTAMP', null),
      environment: process.env.NODE_ENV ?? 'development',
    };
  }

  getInfo(): VersionInfo {
    return this.info;
  }
}

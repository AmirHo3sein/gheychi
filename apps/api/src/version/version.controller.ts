import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { VersionInfo, VersionService } from './version.service';

@Controller()
@Public()
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  // PUBLIC: a genuinely safe deploy-identity endpoint -- no secrets, no DB credentials,
  // no internal paths, just "what code is this, and when was it built." Reachable with
  // no session so external tooling (deploy scripts, uptime/monitoring checks, support
  // triage) can confirm what's actually running without needing credentials. See
  // route-guard-audit.spec.ts's PUBLIC_ROUTES allowlist for this route.
  @Get('version')
  getVersion(): VersionInfo {
    return this.versionService.getInfo();
  }
}

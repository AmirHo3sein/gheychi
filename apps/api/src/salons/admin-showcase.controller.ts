import {
  Body, ConflictException, Controller, NotFoundException, Param, ParseUUIDPipe, Patch, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminShowcaseStatusDto } from './dto/admin-showcase-status.dto';
import { PortfolioItem } from './portfolio-item.entity';
import { SalonStory } from './salon-story.entity';

/**
 * Admin remove/restore toggle for showcase content (salon-showcase spec, §Admin).
 * A plain status set, never a hard delete — moderation stays reversible and the row
 * (evidence) is retained; storage objects ride the normal GC/delete paths. Routes are
 * id-addressed under `admin/stories|portfolio` (NOT `admin/salons/...`) because the
 * target is the content row itself, not a salon-scoped collection.
 */
@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminShowcaseController {
  constructor(
    @InjectRepository(SalonStory) private readonly stories: Repository<SalonStory>,
    @InjectRepository(PortfolioItem) private readonly portfolioItems: Repository<PortfolioItem>,
  ) {}

  @Patch('stories/:id/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.story.status.set', 'story')
  async setStoryStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminShowcaseStatusDto) {
    const story = await this.stories.findOneBy({ id });
    if (!story) throw new NotFoundException();
    // Conditional update on the opposite status — the same lost-race guard as
    // ContentService.publishPost()/ReportsService.resolve(): a concurrent admin who
    // already flipped this row means this write affects 0 rows and the loser gets a
    // clear 409 instead of silently re-applying (and re-auditing) a no-op.
    const result = await this.stories.update({ id, status: oppositeOf(dto.status) }, { status: dto.status });
    if (!result.affected) throw alreadyInState(dto.status);
    return this.stories.findOneByOrFail({ id });
  }

  @Patch('portfolio/:id/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('salon.portfolio.status.set', 'portfolioitem')
  async setPortfolioStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminShowcaseStatusDto) {
    const item = await this.portfolioItems.findOneBy({ id });
    if (!item) throw new NotFoundException();
    // Same conditional-update race guard as setStoryStatus above.
    const result = await this.portfolioItems.update({ id, status: oppositeOf(dto.status) }, { status: dto.status });
    if (!result.affected) throw alreadyInState(dto.status);
    return this.portfolioItems.findOneByOrFail({ id });
  }
}

function oppositeOf(status: 'published' | 'removed'): 'published' | 'removed' {
  return status === 'removed' ? 'published' : 'removed';
}

function alreadyInState(status: 'published' | 'removed'): ConflictException {
  return new ConflictException(status === 'removed' ? 'این مورد قبلاً حذف شده است' : 'این مورد در حال حاضر منتشر است');
}

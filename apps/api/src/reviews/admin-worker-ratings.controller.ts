import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminWorkerRatingQueryDto } from './dto/admin-worker-rating-query.dto';
import { ModerateWorkerRatingDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';
import { WorkerRating } from './worker-rating.entity';

// Mirrors AdminReviewsController's exact list/publish/reject pattern, on a distinct
// resource path since worker ratings are a separate moderation surface from salon
// reviews (see worker-rating.entity.ts). Backs the admin-panel's dedicated
// /worker-ratings screen (design spec §8).
@Controller('admin/worker-ratings')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminWorkerRatingsController {
  constructor(
    @InjectRepository(WorkerRating) private readonly workerRatingsRepo: Repository<WorkerRating>,
    private readonly reviews: ReviewsService,
  ) {}

  @Get()
  list(@Query() query: AdminWorkerRatingQueryDto) {
    return this.reviews.listWorkerRatingsForAdmin(query);
  }

  @Patch(':id/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('worker-rating.moderate', 'worker-rating')
  async moderate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateWorkerRatingDto, @Req() req: Request) {
    // Real before/after status diff for AuditInterceptor (see its doc comment).
    // Left unset (falls back to the raw request body) when the target rating
    // doesn't exist -- ReviewsService.moderateWorkerRating below still 404s
    // exactly as before, this fetch just can't contribute a "before" snapshot
    // in that case.
    const before = await this.workerRatingsRepo.findOne({ where: { id }, select: ['id', 'status'] });
    if (before) req.auditBefore = { status: before.status };

    const updated = await this.reviews.moderateWorkerRating(id, dto.status);
    req.auditAfter = { status: updated.status };
    return updated;
  }
}

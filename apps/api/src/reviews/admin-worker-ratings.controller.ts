import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminWorkerRatingQueryDto } from './dto/admin-worker-rating-query.dto';
import { ModerateWorkerRatingDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

// Mirrors AdminReviewsController's exact list/publish/reject pattern, on a distinct
// resource path since worker ratings are a separate moderation surface from salon
// reviews (see worker-rating.entity.ts). Backs the admin-panel's dedicated
// /worker-ratings screen (design spec §8).
@Controller('admin/worker-ratings')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminWorkerRatingsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query() query: AdminWorkerRatingQueryDto) {
    return this.reviews.listWorkerRatingsForAdmin(query);
  }

  @Patch(':id/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('worker-rating.moderate', 'worker-rating')
  moderate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateWorkerRatingDto) {
    return this.reviews.moderateWorkerRating(id, dto.status);
  }
}

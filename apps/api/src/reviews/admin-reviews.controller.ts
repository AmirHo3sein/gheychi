import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminReviewQueryDto } from './dto/admin-review-query.dto';
import { ModerateReviewDto } from './dto/review.dto';
import { Review } from './review.entity';
import { ReviewsService } from './reviews.service';

@Controller('admin/reviews')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminReviewsController {
  constructor(
    @InjectRepository(Review) private readonly reviewsRepo: Repository<Review>,
    private readonly reviews: ReviewsService,
  ) {}

  @Get()
  list(@Query() query: AdminReviewQueryDto) {
    return this.reviews.listForAdmin(query);
  }

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('review.moderate', 'review')
  async moderate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateReviewDto, @Req() req: Request) {
    // Real before/after status diff for AuditInterceptor (see its doc comment).
    // Left unset (falls back to the raw request body) when the target review
    // doesn't exist -- ReviewsService.moderate below still 404s exactly as
    // before, this fetch just can't contribute a "before" snapshot in that case.
    const before = await this.reviewsRepo.findOne({ where: { id }, select: ['id', 'status'] });
    if (before) req.auditBefore = { status: before.status };

    const updated = await this.reviews.moderate(id, dto.status);
    req.auditAfter = { status: updated.status };
    return updated;
  }
}

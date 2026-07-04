import { Body, Controller, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ModerateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('admin/reviews')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Patch(':id')
  moderate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateReviewDto) {
    return this.reviews.moderate(id, dto.status);
  }
}

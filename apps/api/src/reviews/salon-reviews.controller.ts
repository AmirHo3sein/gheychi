import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { SalonReviewsQueryDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('salons/:salonId/reviews')
@Public()
export class SalonReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Param('salonId', ParseUUIDPipe) salonId: string, @Query() query: SalonReviewsQueryDto) {
    return this.reviews.listForSalon(salonId, query.page, query.pageSize);
  }
}

import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

@Controller('salons/:salonId/reviews')
export class SalonReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Param('salonId', ParseUUIDPipe) salonId: string) {
    return this.reviews.findForSalon(salonId);
  }
}

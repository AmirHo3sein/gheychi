import { Body, Controller, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { SalonReplyDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('salons/mine/reviews')
@UseGuards(SalonOwnerGuard)
export class SalonReviewReplyController {
  constructor(private readonly reviews: ReviewsService) {}

  @Patch(':id/reply')
  reply(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SalonReplyDto) {
    return this.reviews.addSalonReply(req.salonId!, id, dto.reply);
  }
}

import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
@UseGuards(AuthGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateReviewDto) {
    return this.reviews.create((req.user as User).id, dto);
  }
}

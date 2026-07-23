import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
@UseGuards(AuthGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateReviewDto) {
    return this.reviews.create((req.user as User).id, dto);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReviewDto) {
    return this.reviews.update((req.user as User).id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.remove((req.user as User).id, id);
  }
}

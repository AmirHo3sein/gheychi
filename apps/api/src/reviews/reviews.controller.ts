import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
@UseGuards(AuthGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  // The customer-side read path for one's own reviews (`/{resource}/mine`, the same
  // convention as GET /bookings/mine). Declared before the :id routes so 'mine' is
  // never swallowed by a param route. The optional `bookingId` filter is what the
  // single-booking detail page uses instead of pulling the caller's whole history.
  @Get('mine')
  listMine(
    @Req() req: Request,
    @Query('bookingId', new ParseUUIDPipe({ optional: true })) bookingId?: string,
  ) {
    return this.reviews.listMine((req.user as User).id, bookingId);
  }

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

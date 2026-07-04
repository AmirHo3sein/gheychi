import { Controller, Get, Param, Query } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityQueryDto } from './dto/booking.dto';

@Controller('salons/:salonId/availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  get(@Param('salonId') salonId: string, @Query() query: AvailabilityQueryDto) {
    return this.availability.computeFor(salonId, query.serviceId);
  }
}

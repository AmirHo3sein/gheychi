import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { SearchQueryDto } from './dto/search.dto';
import { SearchService } from './search.service';

@Controller('search')
@Public()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  run(@Query() query: SearchQueryDto) {
    return this.search.search(query);
  }
}

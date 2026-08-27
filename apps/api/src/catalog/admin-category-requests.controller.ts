import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { CategoryRequest } from './category-request.entity';
import { CategoryRequestsService } from './category-requests.service';
import { AdminCategoryRequestQueryDto, ApproveCategoryRequestDto, RejectCategoryRequestDto } from './dto/category-request.dto';

@Controller('admin/category-requests')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminCategoryRequestsController {
  constructor(
    private readonly categoryRequests: CategoryRequestsService,
    @InjectRepository(CategoryRequest) private readonly requestsRepo: Repository<CategoryRequest>,
  ) {}

  @Get()
  list(@Query() query: AdminCategoryRequestQueryDto) {
    return this.categoryRequests.listForAdmin(query);
  }

  @Patch(':id/approve')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category-request.approve', 'category-request')
  async approve(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveCategoryRequestDto) {
    const before = await this.requestsRepo.findOneBy({ id });
    if (before) req.auditBefore = { status: before.status };

    const updated = await this.categoryRequests.approve((req.user as User).id, id, dto);
    req.auditAfter = { status: updated.status, categoryId: updated.categoryId, resolvedBy: updated.resolvedBy };
    return updated;
  }

  @Patch(':id/reject')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('category-request.reject', 'category-request')
  async reject(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectCategoryRequestDto) {
    const before = await this.requestsRepo.findOneBy({ id });
    if (before) req.auditBefore = { status: before.status };

    const updated = await this.categoryRequests.reject((req.user as User).id, id, dto);
    req.auditAfter = { status: updated.status, resolutionNote: updated.resolutionNote, resolvedBy: updated.resolvedBy };
    return updated;
  }
}

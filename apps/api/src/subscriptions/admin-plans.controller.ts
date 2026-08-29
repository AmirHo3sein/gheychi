import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { Plan } from './plan.entity';
import { PlansService } from './plans.service';

@Controller('admin/plans')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminPlansController {
  constructor(
    private readonly plans: PlansService,
    @InjectRepository(Plan) private readonly plansRepo: Repository<Plan>,
  ) {}

  @Get()
  list() {
    return this.plans.list();
  }

  @Post()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('plan.create', 'plan')
  create(@Body() dto: CreatePlanDto) {
    return this.plans.create(dto);
  }

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('plan.update', 'plan')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto, @Req() req: Request) {
    const before = await this.plansRepo.findOneBy({ id });
    if (before) {
      req.auditBefore = {
        name: before.name,
        monthlyPriceToman: before.monthlyPriceToman,
        isActive: before.isActive,
        isDefault: before.isDefault,
        entitlements: before.entitlements,
      };
    }

    const updated = await this.plans.update(id, dto);
    req.auditAfter = {
      name: updated.name,
      monthlyPriceToman: updated.monthlyPriceToman,
      isActive: updated.isActive,
      isDefault: updated.isDefault,
      entitlements: updated.entitlements,
    };
    return updated;
  }

  @Delete(':id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('plan.delete', 'plan')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const before = await this.plansRepo.findOneBy({ id });
    if (before) req.auditBefore = { key: before.key, name: before.name };

    await this.plans.remove(id);
  }
}

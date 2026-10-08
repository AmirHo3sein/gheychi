import {
  Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { isForeignKeyViolation, isUniqueViolation } from '../common/postgres-error-codes';
import { BeautyConcept } from './beauty-concept.entity';
import { CreateBeautyConceptDto, UpdateBeautyConceptDto } from './dto/beauty-guide.dto';

/**
 * Admin management of Beauty Guide's vocabulary and its concept → service-category
 * mapping. No delete: guides reference concepts, so retiring one is `isActive=false`
 * (the AI stops being offered it; existing guides keep showing it).
 */
@Controller('admin/beauty-concepts')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminBeautyConceptsController {
  constructor(@InjectRepository(BeautyConcept) private readonly concepts: Repository<BeautyConcept>) {}

  @Get()
  list() {
    return this.concepts.find({ order: { domain: 'ASC', sortOrder: 'ASC', key: 'ASC' } });
  }

  @Post()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('beauty_concept.create', 'beauty_concept')
  async create(@Body() dto: CreateBeautyConceptDto) {
    try {
      return await this.concepts.save(this.concepts.create({ ...dto, keywords: dto.keywords ?? [] }));
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('beauty_concept.update', 'beauty_concept')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBeautyConceptDto, @Req() req: Request) {
    const before = await this.concepts.findOneBy({ id });
    if (!before) throw new NotFoundException();
    req.auditBefore = { ...before };
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    try {
      await this.concepts.update({ id }, patch);
    } catch (err) {
      throw this.mapWriteError(err);
    }
    const after = await this.concepts.findOneBy({ id });
    req.auditAfter = after ? { ...after } : undefined;
    return after;
  }

  private mapWriteError(err: unknown): unknown {
    if (isUniqueViolation(err)) return new ConflictException('مفهومی با این کلید از قبل وجود دارد');
    if (isForeignKeyViolation(err)) return new ConflictException('دسته‌بندی انتخاب‌شده وجود ندارد');
    return err;
  }
}

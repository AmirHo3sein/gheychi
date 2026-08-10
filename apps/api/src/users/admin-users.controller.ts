import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminUsersService } from './admin-users.service';
import { AdminUserQueryDto, UpdateUserStatusDto } from './dto/admin-user.dto';
import { User } from './user.entity';

@Controller('admin/users')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly adminUsers: AdminUsersService,
  ) {}

  @Get()
  async list(@Query() query: AdminUserQueryDto) {
    const qb = this.users
      .createQueryBuilder('user')
      .select(['user.id', 'user.phone', 'user.name', 'user.role', 'user.status', 'user.createdAt'])
      .orderBy('user.createdAt', 'DESC');

    if (query.phone) qb.andWhere('user.phone ILIKE :phone', { phone: `%${query.phone}%` });
    if (query.name) qb.andWhere('user.name ILIKE :name', { name: `%${query.name}%` });
    if (query.role) qb.andWhere('user.role = :role', { role: query.role });
    if (query.joinedFrom) qb.andWhere('user.createdAt >= :joinedFrom', { joinedFrom: query.joinedFrom });
    if (query.joinedTo) qb.andWhere('user.createdAt <= :joinedTo', { joinedTo: query.joinedTo });

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  @Patch(':id/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('user.status.set', 'user')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto, @Req() req: Request) {
    return this.adminUsers.setStatus((req.user as User).id, id, dto.status);
  }
}

import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Body, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminUserQueryDto, AdminUserStatusDto } from './dto/admin-user.dto';
import { User } from './user.entity';

@Controller('admin/users')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  @Get()
  list(@Query() query: AdminUserQueryDto) {
    const qb = this.users
      .createQueryBuilder('user')
      .select(['user.id', 'user.phone', 'user.name', 'user.role', 'user.status', 'user.createdAt'])
      .orderBy('user.createdAt', 'DESC');

    if (query.phone) qb.andWhere('user.phone ILIKE :phone', { phone: `%${query.phone}%` });
    if (query.name) qb.andWhere('user.name ILIKE :name', { name: `%${query.name}%` });
    if (query.role) qb.andWhere('user.role = :role', { role: query.role });
    if (query.joinedFrom) qb.andWhere('user.createdAt >= :joinedFrom', { joinedFrom: query.joinedFrom });
    if (query.joinedTo) qb.andWhere('user.createdAt <= :joinedTo', { joinedTo: query.joinedTo });

    return qb.getMany();
  }

  @Patch(':id/status')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUserStatusDto) {
    const result = await this.users.update({ id }, { status: dto.status });
    if (!result.affected) throw new NotFoundException();
    const { id: userId, phone, name, role, status, createdAt } = (await this.users.findOneBy({ id }))!;
    return { id: userId, phone, name, role, status, createdAt };
  }
}

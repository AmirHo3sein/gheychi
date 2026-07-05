import {
  Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { Salon } from '../salons/salon.entity';
import { User } from '../users/user.entity';
import { Favorite } from './favorite.entity';

@Controller()
@UseGuards(AuthGuard)
export class FavoritesController {
  constructor(
    @InjectRepository(Favorite) private readonly favorites: Repository<Favorite>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
  ) {}

  @Get('favorites')
  async list(@Req() req: Request) {
    const rows = await this.favorites.find({ where: { userId: (req.user as User).id } });
    if (rows.length === 0) return [];
    return this.salons.find({ where: rows.map((r) => ({ id: r.salonId })) });
  }

  @Post('salons/:id/favorite')
  async add(@Req() req: Request, @Param('id', ParseUUIDPipe) salonId: string) {
    const userId = (req.user as User).id;
    const existing = await this.favorites.findOneBy({ userId, salonId });
    if (!existing) await this.favorites.save(this.favorites.create({ userId, salonId }));
    return { ok: true };
  }

  @Delete('salons/:id/favorite')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) salonId: string) {
    await this.favorites.delete({ userId: (req.user as User).id, salonId });
  }
}

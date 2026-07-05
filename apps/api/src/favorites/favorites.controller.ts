import {
  Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { QueryFailedError, Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { UNIQUE_VIOLATION } from '../common/postgres-error-codes';
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
    if (existing) return { ok: true };
    try {
      await this.favorites.save(this.favorites.create({ userId, salonId }));
    } catch (err) {
      // The pre-check above handles the common case, but the composite
      // (user_id, salon_id) PRIMARY KEY is the actual source of truth --
      // two truly concurrent POSTs can both pass the check above before either
      // inserts. Treat the resulting unique violation as the no-op it
      // semantically is, rather than letting it surface as an unhandled 500.
      if (!(err instanceof QueryFailedError) || (err as unknown as { code?: string }).code !== UNIQUE_VIOLATION) {
        throw err;
      }
    }
    return { ok: true };
  }

  @Delete('salons/:id/favorite')
  @HttpCode(204)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) salonId: string) {
    await this.favorites.delete({ userId: (req.user as User).id, salonId });
  }
}

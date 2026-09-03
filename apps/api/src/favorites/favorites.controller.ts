import {
  Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource, Repository } from 'typeorm';
import { isForeignKeyViolation, isUniqueViolation } from '../common/postgres-error-codes';
import { User } from '../users/user.entity';
import { Favorite } from './favorite.entity';

export interface FavoriteSalonItem {
  id: string;
  name: string;
  slug: string;
  city: string;
  ratingAvg: number;
  ratingCount: number;
  coverPhoto: string | null;
  categories: Array<{ id: number; name: string; icon: string }>;
}

@Controller()
export class FavoritesController {
  constructor(
    @InjectRepository(Favorite) private readonly favorites: Repository<Favorite>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Get('favorites')
  async list(@Req() req: Request): Promise<FavoriteSalonItem[]> {
    const userId = (req.user as User).id;
    // Same cover-photo/categories shape as SearchService's card feed (see search.service.ts)
    // -- the client's favourites list reuses the exact same card presentation as search
    // results, so it needs the same fields. distanceKm/minPrice are deliberately NOT
    // included: both only mean something relative to a search origin, which a saved-salons
    // list has no equivalent of.
    const rows = await this.dataSource.query(
      `
      SELECT
        s.id, s.name, s.slug, s.city, s.rating_avg, s.rating_count,
        (SELECT sp.url FROM salon_photos sp
           WHERE sp.salon_id = s.id ORDER BY sp.is_cover DESC, sp.sort_order ASC LIMIT 1) AS cover_photo,
        COALESCE((
          SELECT json_agg(json_build_object('id', sc.id, 'name', sc.name, 'icon', sc.icon) ORDER BY sc.name)
          FROM salon_categories salc JOIN service_categories sc ON sc.id = salc.category_id
          WHERE salc.salon_id = s.id
        ), '[]'::json) AS categories
      FROM salons s
      JOIN salon_favorites f ON f.salon_id = s.id
      -- Same visibility gate as every other public salon listing (SalonsService.
      -- findPublicBySlug, SearchService) -- a salon the customer favorited before it was
      -- suspended/rejected, or one still pending review, must not keep appearing here. The
      -- salon_favorites row itself is left untouched (not deleted): if the salon is later
      -- re-approved, it reappears without the customer having to re-favorite it.
      WHERE f.user_id = $1 AND s.status = 'approved'
      ORDER BY f.created_at DESC
      `,
      [userId],
    );

    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      slug: r.slug as string,
      city: r.city as string,
      ratingAvg: Number(r.rating_avg),
      ratingCount: Number(r.rating_count),
      coverPhoto: (r.cover_photo as string) ?? null,
      categories: r.categories as Array<{ id: number; name: string; icon: string }>,
    }));
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
      if (isForeignKeyViolation(err)) {
        // No such salon. Reported as a clean 404 rather than an unhandled 500: a 500 here
        // is both an error-tracking false alarm and a weak existence oracle, since the two
        // outcomes are distinguishable from outside.
        throw new NotFoundException('Salon not found');
      }
      if (!isUniqueViolation(err)) {
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

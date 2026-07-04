import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../users/user.entity';
import { SalonsService } from './salons.service';

/**
 * Must run after AuthGuard (reads req.user). Resolves the caller's own salon
 * and attaches its id to req.salonId, 404ing via SalonsService.findMine if
 * they don't have one. Replaces the private mySalonId(req) helper that was
 * duplicated across salon-services.controller.ts and schedule.controller.ts.
 */
@Injectable()
export class SalonOwnerGuard implements CanActivate {
  constructor(private readonly salons: SalonsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const salon = await this.salons.findMine((req.user as User).id);
    req.salonId = salon.id;
    return true;
  }
}

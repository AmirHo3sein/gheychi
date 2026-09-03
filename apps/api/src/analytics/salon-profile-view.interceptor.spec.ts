import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AnalyticsService } from './analytics.service';
import { isPublicSalonProfilePath, SalonProfileViewInterceptor } from './salon-profile-view.interceptor';

describe('isPublicSalonProfilePath', () => {
  it('matches the public salon profile route', () => {
    expect(isPublicSalonProfilePath('/api/salons/salon-e-zibaei')).toBe(true);
    // Without the global prefix too, so a prefix change can't silently disable the event.
    expect(isPublicSalonProfilePath('/salons/salon-e-zibaei')).toBe(true);
  });

  it("never matches the owner's own salon route", () => {
    expect(isPublicSalonProfilePath('/api/salons/mine')).toBe(false);
  });

  it('never matches the deeper public content routes hanging off the same slug', () => {
    for (const suffix of ['canonical', 'services', 'hours', 'stories', 'portfolio', 'reviews']) {
      expect(isPublicSalonProfilePath(`/api/salons/my-salon/${suffix}`)).toBe(false);
    }
  });

  it('never matches the admin salon detail route', () => {
    expect(isPublicSalonProfilePath('/api/admin/salons/a-uuid')).toBe(false);
  });

  it('ignores a query string', () => {
    expect(isPublicSalonProfilePath('/api/salons/my-salon?ref=qr')).toBe(true);
  });

  it('does not match unrelated routes', () => {
    expect(isPublicSalonProfilePath('/api/bookings/mine')).toBe(false);
    expect(isPublicSalonProfilePath('/api/salons')).toBe(false);
    expect(isPublicSalonProfilePath('/')).toBe(false);
  });
});

describe('SalonProfileViewInterceptor', () => {
  let track: jest.Mock;
  let interceptor: SalonProfileViewInterceptor;

  beforeEach(() => {
    track = jest.fn().mockResolvedValue(undefined);
    interceptor = new SalonProfileViewInterceptor({ track } as unknown as AnalyticsService);
  });

  function contextFor(path: string, method = 'GET', user?: { id: string }): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ method, path, user }) }),
    } as unknown as ExecutionContext;
  }

  function handlerReturning(body: unknown): CallHandler {
    return { handle: () => of(body) };
  }

  it('emits salon_profile_viewed with the salon id from the response body', async () => {
    await firstValueFrom(
      interceptor.intercept(contextFor('/api/salons/my-salon'), handlerReturning({ id: 'salon-1', name: 'X' })),
    );

    expect(track).toHaveBeenCalledWith('salon_profile_viewed', { salonId: 'salon-1' }, { userId: undefined });
  });

  it('attributes the view to the viewer when they happen to be logged in', async () => {
    await firstValueFrom(
      interceptor.intercept(contextFor('/api/salons/my-salon', 'GET', { id: 'user-9' }), handlerReturning({ id: 'salon-1' })),
    );

    expect(track).toHaveBeenCalledWith('salon_profile_viewed', { salonId: 'salon-1' }, { userId: 'user-9' });
  });

  it('emits nothing for any other route', async () => {
    await firstValueFrom(interceptor.intercept(contextFor('/api/salons/mine'), handlerReturning({ id: 'salon-1' })));
    await firstValueFrom(interceptor.intercept(contextFor('/api/bookings/mine'), handlerReturning({ id: 'b-1' })));

    expect(track).not.toHaveBeenCalled();
  });

  it('emits nothing for a non-GET request to the same path', async () => {
    await firstValueFrom(
      interceptor.intercept(contextFor('/api/salons/my-salon', 'PATCH'), handlerReturning({ id: 'salon-1' })),
    );

    expect(track).not.toHaveBeenCalled();
  });

  it('emits nothing when the response carries no salon id (shape change degrades to silence)', async () => {
    await firstValueFrom(interceptor.intercept(contextFor('/api/salons/my-salon'), handlerReturning({ name: 'X' })));

    expect(track).not.toHaveBeenCalled();
  });

  it('emits nothing when the handler errored -- a 404 for an unknown slug is not a view', async () => {
    const failing: CallHandler = { handle: () => throwError(() => new Error('not found')) };

    await expect(firstValueFrom(interceptor.intercept(contextFor('/api/salons/ghost'), failing))).rejects.toThrow();
    expect(track).not.toHaveBeenCalled();
  });

  it('never lets an analytics failure reach the response', async () => {
    track.mockRejectedValue(new Error('analytics down'));

    const body = await firstValueFrom(
      interceptor.intercept(contextFor('/api/salons/my-salon'), handlerReturning({ id: 'salon-1' })),
    );

    expect(body).toEqual({ id: 'salon-1' });
  });
});

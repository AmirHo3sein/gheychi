import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

// Instantiated directly (not via Test.createTestingModule), same convention as
// salon-workers.controller.spec.ts -- @UseGuards(AuthGuard) references a real guard
// class that itself needs JwtService/UsersService, which a bare controller-only
// testing module can't resolve. Auth/role-guard behavior (401/403) is exercised for
// real in test/wallet.e2e-spec.ts; these tests cover the controller's own logic only.
describe('WalletController', () => {
  let controller: WalletController;
  let getBalances: jest.Mock;
  let getTransactions: jest.Mock;

  beforeEach(() => {
    getBalances = jest.fn();
    getTransactions = jest.fn();
    controller = new WalletController({ getBalances, getTransactions } as unknown as WalletService);
  });

  it('GET / returns {balances: [{currency, balance}]} for the caller only', async () => {
    getBalances.mockResolvedValue([
      { userId: 'u1', currency: 'toman', balance: 1000, updatedAt: new Date() },
      { userId: 'u1', currency: 'points', balance: 5, updatedAt: new Date() },
    ]);
    const req = { user: { id: 'u1' } } as any;

    const result = await controller.getBalances(req);

    expect(getBalances).toHaveBeenCalledWith('u1');
    expect(result).toEqual({
      balances: [
        { currency: 'toman', balance: 1000 },
        { currency: 'points', balance: 5 },
      ],
    });
  });

  it('GET /transactions scopes to the caller and forwards page/pageSize', () => {
    const req = { user: { id: 'u1' } } as any;
    controller.getTransactions(req, { page: 2, pageSize: 5 });
    expect(getTransactions).toHaveBeenCalledWith('u1', { page: 2, pageSize: 5 });
  });
});

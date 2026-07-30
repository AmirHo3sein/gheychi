import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { IRAN_MOBILE } from '../src/auth/dto/auth.dto';
import { User } from '../src/users/user.entity';

export type CreateAdminResult = 'created' | 'promoted' | 'already-admin';

/**
 * Idempotent first-admin bootstrap: upserts the user by phone and guarantees
 * role='admin', status='active'. Never demotes anyone.
 */
export async function createAdmin(dataSource: DataSource, phone: string): Promise<CreateAdminResult> {
  if (!IRAN_MOBILE.test(phone)) {
    throw new Error(`"${phone}" is not a valid Iranian mobile number (expected 09xxxxxxxxx)`);
  }
  const users = dataSource.getRepository(User);
  const existing = await users.findOneBy({ phone });
  if (!existing) {
    await users.save(users.create({ phone, role: 'admin', status: 'active' }));
    return 'created';
  }
  if (existing.role === 'admin' && existing.status === 'active') {
    return 'already-admin';
  }
  existing.role = 'admin';
  existing.status = 'active';
  await users.save(existing);
  return 'promoted';
}

/**
 * pnpm 9 leaks the `--` separator into forwarded script args as a literal
 * first argument. Tolerate both invocation forms by skipping a leading `--`.
 */
export function resolvePhoneArg(args: string[]): string | undefined {
  return args[0] === '--' ? args[1] : args[0];
}

const USAGE = 'Usage: pnpm --filter @gheychi/api create-admin 09xxxxxxxxx';

async function main(): Promise<void> {
  const phone = resolvePhoneArg(process.argv.slice(2));
  if (!phone) {
    console.error(USAGE);
    process.exit(1);
  }
  // Imported lazily so the unit spec never touches dotenv/DataSource construction.
  const { AppDataSource } = await import('../src/data-source');
  await AppDataSource.initialize();
  try {
    const result = await createAdmin(AppDataSource, phone);
    const messages: Record<CreateAdminResult, string> = {
      created: `created new admin user ${phone}`,
      promoted: `promoted existing user ${phone} to active admin`,
      'already-admin': `${phone} is already an active admin — nothing to do`,
    };
    console.log(messages[result]);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    console.error(USAGE);
    process.exit(1);
  });
}

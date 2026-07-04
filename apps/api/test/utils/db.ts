import { config } from 'dotenv';
config({ path: '.env.test' });
import { DataSource } from 'typeorm';

export function testDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: +(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    migrations: ['src/migrations/*.ts'],
  });
}

export async function resetDatabase(): Promise<void> {
  const ds = testDataSource();
  await ds.initialize();
  await ds.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await ds.runMigrations();
  await ds.destroy();
}

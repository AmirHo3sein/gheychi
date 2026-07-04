import 'dotenv/config';
import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: +(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'arayeshgah',
  password: process.env.DB_PASS ?? 'arayeshgah',
  database: process.env.DB_NAME ?? 'arayeshgah',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});

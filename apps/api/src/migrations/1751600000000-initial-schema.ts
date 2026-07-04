import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1751600000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS postgis`);

    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        phone varchar(15) NOT NULL UNIQUE,
        name varchar(100),
        gender varchar(10),
        role varchar(10) NOT NULL DEFAULT 'customer',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE salons (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES users(id),
        name varchar(150) NOT NULL,
        slug varchar(180) NOT NULL UNIQUE,
        description text,
        gender_target varchar(10) NOT NULL,
        status varchar(12) NOT NULL DEFAULT 'pending',
        address text NOT NULL,
        city varchar(80) NOT NULL,
        location geography(Point,4326) NOT NULL,
        capacity int NOT NULL DEFAULT 1,
        rating_avg numeric(3,2) NOT NULL DEFAULT 0,
        rating_count int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX salons_owner_uidx ON salons(owner_id)`);
    await q.query(`CREATE INDEX salons_location_gist ON salons USING GIST(location)`);
    await q.query(`CREATE INDEX salons_status_gender_idx ON salons(status, gender_target)`);

    await q.query(`
      CREATE TABLE service_categories (
        id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name varchar(60) NOT NULL UNIQUE,
        icon varchar(40) NOT NULL
      )`);

    await q.query(`
      CREATE TABLE salon_services (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        category_id int NOT NULL REFERENCES service_categories(id),
        name varchar(150) NOT NULL,
        description text,
        price bigint NOT NULL,
        duration_min int NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX salon_services_salon_idx ON salon_services(salon_id)`);

    await q.query(`
      CREATE TABLE salon_photos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        url text NOT NULL,
        sort_order int NOT NULL DEFAULT 0,
        is_cover boolean NOT NULL DEFAULT false
      )`);

    await q.query(`
      CREATE TABLE working_hours (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        open_time time NOT NULL,
        close_time time NOT NULL,
        UNIQUE(salon_id, weekday, open_time)
      )`);

    await q.query(`
      CREATE TABLE schedule_exceptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        date date NOT NULL,
        is_closed boolean NOT NULL DEFAULT true,
        UNIQUE(salon_id, date)
      )`);

    await q.query(`
      CREATE TABLE platform_config (
        key varchar(60) PRIMARY KEY,
        value jsonb NOT NULL
      )`);

    await q.query(`
      INSERT INTO service_categories (name, icon) VALUES
        ('Haircut', 'scissors'),
        ('Hair Color', 'palette'),
        ('Hair Treatment', 'droplet'),
        ('Nails', 'nail'),
        ('Skin & Facial', 'sparkles'),
        ('Makeup', 'brush'),
        ('Eyebrows & Lashes', 'eye'),
        ('Grooming', 'razor')`);

    await q.query(`
      INSERT INTO platform_config (key, value) VALUES
        ('deposit_percent', '20'),
        ('deposit_min_toman', '200000'),
        ('cancellation_window_hours', '24'),
        ('commission_percent', '10'),
        ('booking_hold_ttl_minutes', '15')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE platform_config`);
    await q.query(`DROP TABLE schedule_exceptions`);
    await q.query(`DROP TABLE working_hours`);
    await q.query(`DROP TABLE salon_photos`);
    await q.query(`DROP TABLE salon_services`);
    await q.query(`DROP TABLE service_categories`);
    await q.query(`DROP TABLE salons`);
    await q.query(`DROP TABLE users`);
  }
}

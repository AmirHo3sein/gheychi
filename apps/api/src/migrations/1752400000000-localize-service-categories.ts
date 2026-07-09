import { MigrationInterface, QueryRunner } from 'typeorm';

const ENGLISH_NAMES = ['Haircut', 'Hair Color', 'Hair Treatment', 'Nails', 'Skin & Facial', 'Makeup', 'Eyebrows & Lashes', 'Grooming'];

const FARSI_CATEGORIES: Array<[string, string]> = [
  ['کوتاهی مو', 'scissors'],
  ['رنگ مو', 'palette'],
  ['مراقبت و درمان مو', 'droplet'],
  ['ناخن', 'nail'],
  ['پوست و صورت', 'sparkles'],
  ['آرایش', 'brush'],
  ['ابرو و مژه', 'eye'],
  ['اصلاح و پیرایش', 'razor'],
  ['کراتین و صافی مو', 'droplet'],
  ['اکستنشن مو', 'sparkles'],
  ['اپیلاسیون و وکس', 'droplet'],
  ['اکستنشن و لمینت مژه', 'eye'],
  ['آرایش عروس و مهمانی', 'palette'],
  ['تاتو و میکروبلیدینگ', 'pencil'],
];

export class LocalizeServiceCategories1752400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The initial schema seeded English category names; a later pass added the
    // correct Farsi equivalents directly to a local DB (never migrated), leaving
    // both sets live at once and no salon_services ever referenced the English rows.
    for (const [name, icon] of FARSI_CATEGORIES) {
      await queryRunner.query(`INSERT INTO service_categories (name, icon) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`, [name, icon]);
    }
    await queryRunner.query(`DELETE FROM service_categories WHERE name = ANY($1)`, [ENGLISH_NAMES]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO service_categories (name, icon) VALUES
        ('Haircut', 'scissors'),
        ('Hair Color', 'palette'),
        ('Hair Treatment', 'droplet'),
        ('Nails', 'nail'),
        ('Skin & Facial', 'sparkles'),
        ('Makeup', 'brush'),
        ('Eyebrows & Lashes', 'eye'),
        ('Grooming', 'razor')
      ON CONFLICT (name) DO NOTHING
    `);
    await queryRunner.query(
      `DELETE FROM service_categories WHERE name = ANY($1)`,
      [FARSI_CATEGORIES.map(([name]) => name)],
    );
  }
}

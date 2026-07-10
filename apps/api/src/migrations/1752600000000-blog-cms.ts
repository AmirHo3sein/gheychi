import { MigrationInterface, QueryRunner } from 'typeorm';

export class BlogCms1752600000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE blog_categories (
        id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name varchar(60) NOT NULL UNIQUE,
        slug varchar(80) NOT NULL UNIQUE
      )`);

    await q.query(`
      CREATE TABLE blog_posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title varchar(200) NOT NULL,
        slug varchar(220) NOT NULL UNIQUE,
        excerpt varchar(500),
        body_markdown text NOT NULL,
        cover_image_key varchar(500),
        category_id int REFERENCES blog_categories(id),   -- bare FK: delete restricts (23503 → 409)
        author_name varchar(80),
        meta_description varchar(300),
        og_title varchar(200),
        status varchar(20) NOT NULL DEFAULT 'draft',       -- 'draft' | 'published'
        published_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX blog_posts_public_idx ON blog_posts (status, published_at DESC)`);
    await q.query(`CREATE INDEX blog_posts_category_idx ON blog_posts (category_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE blog_posts`);
    await q.query(`DROP TABLE blog_categories`);
  }
}

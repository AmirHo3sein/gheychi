import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type BlogPostStatus = 'draft' | 'published';

@Entity('blog_posts')
export class BlogPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'varchar', nullable: true })
  excerpt: string | null;

  @Column({ name: 'body_markdown', type: 'text' })
  bodyMarkdown: string;

  @Column({ name: 'cover_image_key', type: 'varchar', nullable: true })
  coverImageKey: string | null;

  // Bare FK — blog_posts.category_id REFERENCES blog_categories(id) lives only in the
  // migration SQL (NO ACTION: category delete restricts, 23503 → 409 in Task 5).
  @Column({ name: 'category_id', type: 'int', nullable: true })
  categoryId: number | null;

  @Column({ name: 'author_name', type: 'varchar', nullable: true })
  authorName: string | null;

  @Column({ name: 'meta_description', type: 'varchar', nullable: true })
  metaDescription: string | null;

  @Column({ name: 'og_title', type: 'varchar', nullable: true })
  ogTitle: string | null;

  @Column({ type: 'varchar', default: 'draft' })
  status: BlogPostStatus;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

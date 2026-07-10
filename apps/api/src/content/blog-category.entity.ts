import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('blog_categories')
export class BlogCategory {
  @PrimaryGeneratedColumn('identity')
  id: number;

  @Column({ unique: true })
  name: string;

  @Column({ unique: true })
  slug: string;
}

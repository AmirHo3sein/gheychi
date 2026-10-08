import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Beauty Guide (docs/superpowers/specs/2026-10-07-beauty-guide-design.md). Purely additive:
 *
 *  - beauty_concepts: the controlled vocabulary the AI is allowed to emit. Each concept maps
 *    to at most ONE global service category -- the only vocabulary shared across salons, so
 *    the only deterministic bridge from "what the AI saw" to "who can actually do it".
 *  - beauty_guides / beauty_guide_concepts: a customer's private guide and its concept set.
 *    User corrections live on beauty_guide_concepts (removed / source='user') and are the
 *    authoritative set from then on.
 *  - bookings.beauty_guide_id: nullable context link, ON DELETE SET NULL. Every existing
 *    booking stays valid; nothing financial reads it.
 *  - portfolio_items(service_id) index for the cross-salon "similar work" query.
 *  - platform_config: feature flag (seeded OFF) + three cost/retention numbers.
 *
 * Concepts are seeded with category_id resolved by category NAME at migration time (ids are
 * identity values and differ per environment). A name that doesn't exist leaves the concept
 * informational (category_id NULL) for an admin to map later -- never a failed migration.
 */
interface ConceptSeed {
  key: string;
  domain: 'hair_color' | 'hair_cut_style' | 'nails' | 'brows_lashes' | 'makeup';
  fa: string;
  en: string;
  category: string;
  keywords: string[];
  maintenance?: string;
}

const CONCEPTS: ConceptSeed[] = [
  // Hair color
  { key: 'balayage', domain: 'hair_color', fa: 'بالیاژ', en: 'Balayage', category: 'رنگ مو', keywords: ['بالیاژ', 'balayage'], maintenance: 'معمولاً هر چند هفته یک‌بار تونر برای حفظ رنگ و هر چند ماه یک‌بار تمدید پیشنهاد می‌شود.' },
  { key: 'highlights', domain: 'hair_color', fa: 'هایلایت', en: 'Highlights', category: 'رنگ مو', keywords: ['هایلایت', 'highlight', 'مش'], maintenance: 'با رشد ریشه، معمولاً بعد از چند ماه نیاز به ترمیم دارد.' },
  { key: 'lowlights', domain: 'hair_color', fa: 'لولایت', en: 'Lowlights', category: 'رنگ مو', keywords: ['لولایت', 'lowlight'] },
  { key: 'babylights', domain: 'hair_color', fa: 'بیبی‌لایت', en: 'Babylights', category: 'رنگ مو', keywords: ['بیبی لایت', 'بیبی‌لایت', 'babylight'] },
  { key: 'root_melt', domain: 'hair_color', fa: 'روت ملت', en: 'Root Melt', category: 'رنگ مو', keywords: ['روت ملت', 'root melt'], maintenance: 'کمک می‌کند رشد ریشه کمتر به چشم بیاید و فاصله ترمیم‌ها بیشتر شود.' },
  { key: 'root_shadow', domain: 'hair_color', fa: 'روت شدو', en: 'Root Shadow', category: 'رنگ مو', keywords: ['روت شدو', 'root shadow'] },
  { key: 'face_framing_highlights', domain: 'hair_color', fa: 'هایلایت دور صورت', en: 'Face-Framing Highlights', category: 'رنگ مو', keywords: ['دور صورت', 'money piece', 'مانی پیس'] },
  { key: 'ombre', domain: 'hair_color', fa: 'آمبره', en: 'Ombré', category: 'رنگ مو', keywords: ['آمبره', 'امبره', 'ombre'] },
  { key: 'color_correction', domain: 'hair_color', fa: 'اصلاح رنگ', en: 'Color Correction', category: 'رنگ مو', keywords: ['اصلاح رنگ', 'color correction'] },
  { key: 'gloss_toner', domain: 'hair_color', fa: 'تونر و گلاس', en: 'Gloss / Toner', category: 'رنگ مو', keywords: ['تونر', 'گلاس', 'toner', 'gloss'], maintenance: 'اثر تونر معمولاً موقت است و ممکن است بعد از چند هفته نیاز به تکرار داشته باشد.' },
  { key: 'full_color', domain: 'hair_color', fa: 'رنگ کامل', en: 'All-Over Color', category: 'رنگ مو', keywords: ['رنگ کامل', 'رنگ مو'] },
  { key: 'platinum_blonde', domain: 'hair_color', fa: 'بلوند پلاتینه', en: 'Platinum Blonde', category: 'رنگ مو', keywords: ['پلاتینه', 'پلاتین', 'platinum', 'دکلره'], maintenance: 'معمولاً نیاز به مراقبت منظم، تونر و ترمیم ریشه دارد.' },
  // Hair cut & style
  { key: 'layered_cut', domain: 'hair_cut_style', fa: 'کوتاهی لایه‌ای', en: 'Layered Cut', category: 'کوتاهی مو', keywords: ['لایه', 'لایه‌ای', 'layer'] },
  { key: 'bob', domain: 'hair_cut_style', fa: 'کوتاهی باب', en: 'Bob', category: 'کوتاهی مو', keywords: ['باب', 'bob'] },
  { key: 'lob', domain: 'hair_cut_style', fa: 'لانگ باب', en: 'Lob', category: 'کوتاهی مو', keywords: ['لانگ باب', 'lob'] },
  { key: 'pixie', domain: 'hair_cut_style', fa: 'کوتاهی پیکسی', en: 'Pixie Cut', category: 'کوتاهی مو', keywords: ['پیکسی', 'pixie'] },
  { key: 'curtain_bangs', domain: 'hair_cut_style', fa: 'چتری پرده‌ای', en: 'Curtain Bangs', category: 'کوتاهی مو', keywords: ['چتری', 'curtain bangs'] },
  { key: 'blunt_cut', domain: 'hair_cut_style', fa: 'کوتاهی صاف (بلانت)', en: 'Blunt Cut', category: 'کوتاهی مو', keywords: ['بلانت', 'blunt'] },
  { key: 'wolf_cut', domain: 'hair_cut_style', fa: 'وولف کات', en: 'Wolf Cut', category: 'کوتاهی مو', keywords: ['وولف', 'wolf'] },
  { key: 'keratin_smoothing', domain: 'hair_cut_style', fa: 'کراتین و صافی', en: 'Keratin Smoothing', category: 'کراتین و صافی مو', keywords: ['کراتین', 'صافی', 'keratin'], maintenance: 'ماندگاری آن به نوع مو و مراقبت در خانه بستگی دارد.' },
  { key: 'hair_treatment', domain: 'hair_cut_style', fa: 'درمان و ماسک مو', en: 'Hair Treatment', category: 'مراقبت و درمان مو', keywords: ['درمان', 'ماسک', 'بوتاکس مو', 'treatment'] },
  // Nails
  { key: 'almond_shape', domain: 'nails', fa: 'فرم بادامی', en: 'Almond Shape', category: 'ناخن', keywords: ['بادامی', 'almond'] },
  { key: 'coffin_shape', domain: 'nails', fa: 'فرم تابوتی (کافین)', en: 'Coffin Shape', category: 'ناخن', keywords: ['کافین', 'تابوتی', 'coffin', 'بالرین'] },
  { key: 'square_shape', domain: 'nails', fa: 'فرم مربعی', en: 'Square Shape', category: 'ناخن', keywords: ['مربعی', 'square'] },
  { key: 'oval_shape', domain: 'nails', fa: 'فرم بیضی', en: 'Oval Shape', category: 'ناخن', keywords: ['بیضی', 'oval'] },
  { key: 'french_tip', domain: 'nails', fa: 'فرنچ', en: 'French Tip', category: 'ناخن', keywords: ['فرنچ', 'french'] },
  { key: 'chrome', domain: 'nails', fa: 'کروم (آینه‌ای)', en: 'Chrome', category: 'ناخن', keywords: ['کروم', 'آینه‌ای', 'chrome'] },
  { key: 'cat_eye', domain: 'nails', fa: 'چشم گربه‌ای', en: 'Cat Eye', category: 'ناخن', keywords: ['چشم گربه', 'مگنتی', 'cat eye'] },
  { key: 'glazed', domain: 'nails', fa: 'گلیزد (دونات)', en: 'Glazed', category: 'ناخن', keywords: ['گلیزد', 'دونات', 'glazed'] },
  { key: 'marble', domain: 'nails', fa: 'طرح مرمری', en: 'Marble', category: 'ناخن', keywords: ['مرمری', 'ماربل', 'marble'] },
  { key: 'matte', domain: 'nails', fa: 'مات', en: 'Matte', category: 'ناخن', keywords: ['مات', 'matte'] },
  { key: 'nail_art', domain: 'nails', fa: 'طراحی ناخن', en: 'Nail Art', category: 'ناخن', keywords: ['طراحی', 'دیزاین', 'nail art'] },
  { key: 'gel_extension', domain: 'nails', fa: 'کاشت ناخن', en: 'Gel Extensions', category: 'ناخن', keywords: ['کاشت', 'ژل', 'extension'], maintenance: 'معمولاً هر چند هفته یک‌بار نیاز به ترمیم دارد.' },
  // Brows & lashes
  { key: 'brow_lamination', domain: 'brows_lashes', fa: 'لیفت و لمینت ابرو', en: 'Brow Lamination', category: 'ابرو و مژه', keywords: ['لمینت ابرو', 'لیفت ابرو', 'brow lamination'] },
  { key: 'lash_lift', domain: 'brows_lashes', fa: 'لیفت و لمینت مژه', en: 'Lash Lift', category: 'اکستنشن و لمینت مژه', keywords: ['لمینت مژه', 'لیفت مژه', 'lash lift'] },
  { key: 'lash_extension', domain: 'brows_lashes', fa: 'اکستنشن مژه', en: 'Lash Extensions', category: 'اکستنشن و لمینت مژه', keywords: ['اکستنشن مژه', 'مژه', 'lash extension'], maintenance: 'معمولاً هر چند هفته یک‌بار نیاز به ترمیم دارد.' },
  // Makeup
  { key: 'natural_makeup', domain: 'makeup', fa: 'آرایش ملایم و طبیعی', en: 'Natural Makeup', category: 'آرایش', keywords: ['ملایم', 'طبیعی', 'natural'] },
  { key: 'soft_glam', domain: 'makeup', fa: 'سافت گلم', en: 'Soft Glam', category: 'آرایش عروس و مهمانی', keywords: ['گلم', 'مجلسی', 'glam'] },
  { key: 'bridal_makeup', domain: 'makeup', fa: 'آرایش عروس', en: 'Bridal Makeup', category: 'آرایش عروس و مهمانی', keywords: ['عروس', 'bridal'] },
];

export class BeautyGuide1757000000000 implements MigrationInterface {
  name = 'BeautyGuide1757000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE beauty_concepts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(60) NOT NULL UNIQUE,
        domain varchar(20) NOT NULL,
        name_fa varchar(80) NOT NULL,
        name_en varchar(80) NOT NULL,
        category_id int NULL REFERENCES service_categories(id) ON DELETE RESTRICT,
        keywords text[] NOT NULL DEFAULT '{}',
        maintenance_fa text NULL,
        is_active boolean NOT NULL DEFAULT true,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT beauty_concepts_domain_chk
          CHECK (domain IN ('hair_color', 'hair_cut_style', 'nails', 'brows_lashes', 'makeup')),
        CONSTRAINT beauty_concepts_key_chk CHECK (key ~ '^[a-z][a-z0-9_]*$')
      )`);

    await q.query(`
      CREATE TABLE beauty_guides (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status varchar(20) NOT NULL DEFAULT 'processing',
        image_key varchar(200) NOT NULL,
        image_sha256 char(64) NOT NULL,
        source_portfolio_item_id uuid NULL REFERENCES portfolio_items(id) ON DELETE SET NULL,
        domain varchar(20) NULL,
        look_summary_fa text NULL,
        stylist_request_fa text NULL,
        duration_min_estimate int NULL,
        duration_max_estimate int NULL,
        attributes jsonb NOT NULL DEFAULT '{}',
        discussion_points jsonb NOT NULL DEFAULT '[]',
        maintenance_ai jsonb NOT NULL DEFAULT '[]',
        safety_note varchar(30) NULL,
        raw_analysis jsonb NULL,
        provider varchar(40) NULL,
        model varchar(100) NULL,
        prompt_version varchar(20) NULL,
        schema_version varchar(20) NULL,
        provider_called boolean NOT NULL DEFAULT false,
        failure_code varchar(30) NULL,
        analyzed_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT beauty_guides_status_chk
          CHECK (status IN ('processing', 'ready', 'unsuitable', 'failed')),
        CONSTRAINT beauty_guides_duration_chk
          CHECK (duration_max_estimate IS NULL OR duration_min_estimate IS NULL
                 OR duration_max_estimate >= duration_min_estimate)
      )`);
    await q.query(`CREATE INDEX beauty_guides_user_created_idx ON beauty_guides(user_id, created_at DESC)`);
    await q.query(`CREATE INDEX beauty_guides_user_hash_idx ON beauty_guides(user_id, image_sha256)`);
    // The daily usage counters scan by analysis time across all users.
    await q.query(`CREATE INDEX beauty_guides_analyzed_idx ON beauty_guides(analyzed_at) WHERE provider_called`);

    await q.query(`
      CREATE TABLE beauty_guide_concepts (
        guide_id uuid NOT NULL REFERENCES beauty_guides(id) ON DELETE CASCADE,
        concept_id uuid NOT NULL REFERENCES beauty_concepts(id) ON DELETE CASCADE,
        confidence varchar(10) NOT NULL,
        source varchar(10) NOT NULL,
        removed boolean NOT NULL DEFAULT false,
        evidence_fa varchar(300) NULL,
        sort_order int NOT NULL DEFAULT 0,
        PRIMARY KEY (guide_id, concept_id),
        CONSTRAINT beauty_guide_concepts_confidence_chk CHECK (confidence IN ('high', 'medium', 'low')),
        CONSTRAINT beauty_guide_concepts_source_chk CHECK (source IN ('ai', 'user'))
      )`);

    await q.query(
      `ALTER TABLE bookings ADD COLUMN beauty_guide_id uuid NULL REFERENCES beauty_guides(id) ON DELETE SET NULL`,
    );
    await q.query(
      `CREATE INDEX bookings_beauty_guide_idx ON bookings(beauty_guide_id) WHERE beauty_guide_id IS NOT NULL`,
    );
    await q.query(`CREATE INDEX portfolio_items_service_idx ON portfolio_items(service_id) WHERE service_id IS NOT NULL`);

    await q.query(
      `INSERT INTO platform_config (key, value) VALUES
         ('feature_beauty_guide_enabled', 'false'),
         ('beauty_guide_daily_limit_per_user', '3'),
         ('beauty_guide_daily_limit_global', '300'),
         ('beauty_guide_retention_days', '90')
       ON CONFLICT (key) DO NOTHING`,
    );

    for (const [i, c] of CONCEPTS.entries()) {
      await q.query(
        `INSERT INTO beauty_concepts (key, domain, name_fa, name_en, category_id, keywords, maintenance_fa, sort_order)
         VALUES ($1, $2, $3, $4, (SELECT id FROM service_categories WHERE name = $5), $6, $7, $8)
         ON CONFLICT (key) DO NOTHING`,
        [c.key, c.domain, c.fa, c.en, c.category, c.keywords, c.maintenance ?? null, i],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM platform_config WHERE key IN ('feature_beauty_guide_enabled',
         'beauty_guide_daily_limit_per_user', 'beauty_guide_daily_limit_global', 'beauty_guide_retention_days')`,
    );
    await q.query(`DROP INDEX IF EXISTS portfolio_items_service_idx`);
    await q.query(`DROP INDEX IF EXISTS bookings_beauty_guide_idx`);
    await q.query(`ALTER TABLE bookings DROP COLUMN IF EXISTS beauty_guide_id`);
    await q.query(`DROP TABLE IF EXISTS beauty_guide_concepts`);
    await q.query(`DROP TABLE IF EXISTS beauty_guides`);
    await q.query(`DROP TABLE IF EXISTS beauty_concepts`);
  }
}

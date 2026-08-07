import { MigrationInterface, QueryRunner } from 'typeorm';

// Promotes the static, unpersisted IRAN_CITIES array (apps/api/src/cities/iran-cities.ts,
// which this migration retires -- see the accompanying code change) into a real table.
// Purely additive: salons.city stays exactly as-is (free text, still the display/source
// of truth for a salon's address), city_id is a nullable, best-effort enrichment link
// resolved by exact name match, backfilled below for every salon whose existing city
// string happens to match one of these canonical names. A salon in a small town not on
// this curated list (same "31 provincial capitals plus other significant centers, not
// every one of Iran's 1,200+ towns" scope the original static list documented) simply
// keeps city_id NULL -- exactly as unlinked as it was before this migration, never
// blocked or altered.
export class CitiesTable1754300000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE cities (
        id SERIAL PRIMARY KEY,
        name varchar NOT NULL UNIQUE,
        slug varchar NOT NULL UNIQUE,
        province varchar NOT NULL,
        lat double precision NOT NULL,
        lng double precision NOT NULL,
        sort_order int NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    // Seed data transcribed and diff-verified against the exact name/lat/lng values in
    // the retired static IRAN_CITIES array -- sort_order preserves that array's original
    // ordering (roughly population/significance-ranked, provincial capitals first),
    // since GET /cities' response order is a real, if implicit, UX contract (a city
    // picker showing "most likely" cities first) this migration must not silently change.
    await q.query(`
      INSERT INTO cities (name, slug, province, lat, lng, sort_order) VALUES
              ('تهران', 'tehran', 'تهران', 35.6892, 51.389, 0),
              ('مشهد', 'mashhad', 'خراسان رضوی', 36.2605, 59.6168, 1),
              ('اصفهان', 'isfahan', 'اصفهان', 32.6546, 51.668, 2),
              ('کرج', 'karaj', 'البرز', 35.84, 50.9391, 3),
              ('شیراز', 'shiraz', 'فارس', 29.5918, 52.5837, 4),
              ('تبریز', 'tabriz', 'آذربایجان شرقی', 38.08, 46.2919, 5),
              ('قم', 'qom', 'قم', 34.6401, 50.8764, 6),
              ('اهواز', 'ahvaz', 'خوزستان', 31.3183, 48.6706, 7),
              ('کرمانشاه', 'kermanshah', 'کرمانشاه', 34.3277, 47.0778, 8),
              ('ارومیه', 'urmia', 'آذربایجان غربی', 37.5527, 45.0761, 9),
              ('رشت', 'rasht', 'گیلان', 37.2809, 49.5832, 10),
              ('زاهدان', 'zahedan', 'سیستان و بلوچستان', 29.4963, 60.8629, 11),
              ('کرمان', 'kerman', 'کرمان', 30.2839, 57.0834, 12),
              ('اراک', 'arak', 'مرکزی', 34.0917, 49.6892, 13),
              ('یزد', 'yazd', 'یزد', 31.8974, 54.3569, 14),
              ('اردبیل', 'ardabil', 'اردبیل', 38.2498, 48.2933, 15),
              ('بندرعباس', 'bandar-abbas', 'هرمزگان', 27.1865, 56.2808, 16),
              ('زنجان', 'zanjan', 'زنجان', 36.6764, 48.4963, 17),
              ('قزوین', 'qazvin', 'قزوین', 36.2688, 50.0041, 18),
              ('سنندج', 'sanandaj', 'کردستان', 35.3144, 46.9923, 19),
              ('خرم‌آباد', 'khorramabad', 'لرستان', 33.4878, 48.3558, 20),
              ('گرگان', 'gorgan', 'گلستان', 36.8427, 54.4396, 21),
              ('ساری', 'sari', 'مازندران', 36.5633, 53.0601, 22),
              ('بوشهر', 'bushehr', 'بوشهر', 28.9684, 50.8385, 23),
              ('بجنورد', 'bojnord', 'خراسان شمالی', 37.4747, 57.3291, 24),
              ('بیرجند', 'birjand', 'خراسان جنوبی', 32.8663, 59.2211, 25),
              ('ایلام', 'ilam', 'ایلام', 33.6374, 46.4227, 26),
              ('شهرکرد', 'shahrekord', 'چهارمحال و بختیاری', 32.3256, 50.8644, 27),
              ('یاسوج', 'yasuj', 'کهگیلویه و بویراحمد', 30.6682, 51.588, 28),
              ('سمنان', 'semnan', 'سمنان', 35.5769, 53.396, 29),
              ('همدان', 'hamedan', 'همدان', 34.7992, 48.5146, 30),
              ('اسلام‌شهر', 'eslamshahr', 'تهران', 35.5449, 51.2274, 31),
              ('ورامین', 'varamin', 'تهران', 35.3269, 51.6453, 32),
              ('شهریار', 'shahriar', 'تهران', 35.6636, 51.0592, 33),
              ('پاکدشت', 'pakdasht', 'تهران', 35.4744, 51.681, 34),
              ('کاشان', 'kashan', 'اصفهان', 33.985, 51.41, 35),
              ('نجف‌آباد', 'najafabad', 'اصفهان', 32.6345, 51.3696, 36),
              ('خمینی‌شهر', 'khomeinishahr', 'اصفهان', 32.7017, 51.5219, 37),
              ('ساوه', 'saveh', 'مرکزی', 35.0213, 50.3564, 38),
              ('قشم', 'qeshm', 'هرمزگان', 26.9581, 56.2719, 39),
              ('بابل', 'babol', 'مازندران', 36.5513, 52.6789, 40),
              ('آمل', 'amol', 'مازندران', 36.4696, 52.3512, 41),
              ('قائم‌شهر', 'qaemshahr', 'مازندران', 36.4643, 52.8571, 42),
              ('بهشهر', 'behshahr', 'مازندران', 36.691, 53.551, 43),
              ('نیشابور', 'neyshabur', 'خراسان رضوی', 36.2135, 58.7958, 44),
              ('سبزوار', 'sabzevar', 'خراسان رضوی', 36.2126, 57.6788, 45),
              ('تربت حیدریه', 'torbat-heydarieh', 'خراسان رضوی', 35.2726, 59.2192, 46),
              ('کاشمر', 'kashmar', 'خراسان رضوی', 35.2377, 58.4674, 47),
              ('دزفول', 'dezful', 'خوزستان', 32.3814, 48.4058, 48),
              ('آبادان', 'abadan', 'خوزستان', 30.3392, 48.3043, 49),
              ('خرمشهر', 'khorramshahr', 'خوزستان', 30.4397, 48.1664, 50),
              ('ماهشهر', 'mahshahr', 'خوزستان', 30.5589, 49.1957, 51),
              ('اندیمشک', 'andimeshk', 'خوزستان', 32.4614, 48.356, 52),
              ('مرودشت', 'marvdasht', 'فارس', 29.8722, 52.8064, 53),
              ('جهرم', 'jahrom', 'فارس', 28.5, 53.5583, 54),
              ('کازرون', 'kazerun', 'فارس', 29.6194, 51.6547, 55),
              ('فسا', 'fasa', 'فارس', 28.9386, 53.6486, 56),
              ('لار', 'lar', 'فارس', 27.6781, 54.3392, 57),
              ('میانه', 'miyaneh', 'آذربایجان شرقی', 37.4275, 47.7028, 58),
              ('مراغه', 'maragheh', 'آذربایجان شرقی', 37.3894, 46.2378, 59),
              ('خوی', 'khoy', 'آذربایجان غربی', 38.5503, 44.9517, 60),
              ('مهاباد', 'mahabad', 'آذربایجان غربی', 36.7631, 45.7219, 61),
              ('بناب', 'bonab', 'آذربایجان شرقی', 37.3436, 46.0575, 62),
              ('بندر انزلی', 'bandar-anzali', 'گیلان', 37.4739, 49.4614, 63),
              ('لاهیجان', 'lahijan', 'گیلان', 37.2064, 50.0044, 64),
              ('رودسر', 'rudsar', 'گیلان', 37.1364, 50.2894, 65),
              ('سیرجان', 'sirjan', 'کرمان', 29.4519, 55.6814, 66),
              ('رفسنجان', 'rafsanjan', 'کرمان', 30.4067, 55.9939, 67),
              ('جیرفت', 'jiroft', 'کرمان', 28.6753, 57.7267, 68),
              ('بم', 'bam', 'کرمان', 29.1053, 58.3572, 69),
              ('گنبد کاووس', 'gonbad-kavus', 'گلستان', 37.2506, 55.1725, 70),
              ('علی‌آباد کتول', 'aliabad-katul', 'گلستان', 36.9147, 54.8611, 71),
              ('شاهرود', 'shahrud', 'سمنان', 36.4181, 54.9764, 72),
              ('دامغان', 'damghan', 'سمنان', 36.1683, 54.348, 73),
              ('ملایر', 'malayer', 'همدان', 34.2967, 48.8175, 74),
              ('نهاوند', 'nahavand', 'همدان', 34.19, 48.3742, 75),
              ('تویسرکان', 'tuyserkan', 'همدان', 34.5453, 48.4467, 76),
              ('بروجرد', 'borujerd', 'لرستان', 33.8975, 48.7517, 77),
              ('الشتر', 'aligudarz', 'لرستان', 33.865, 48.2814, 78),
              ('زابل', 'zabol', 'سیستان و بلوچستان', 31.0296, 61.5033, 79),
              ('ایرانشهر', 'iranshahr', 'سیستان و بلوچستان', 27.2025, 60.685, 80),
              ('چابهار', 'chabahar', 'سیستان و بلوچستان', 25.2919, 60.643, 81),
              ('میناب', 'minab', 'هرمزگان', 27.1467, 57.0801, 82),
              ('کیش', 'kish', 'هرمزگان', 26.5578, 53.9819, 83),
              ('گچساران', 'gachsaran', 'کهگیلویه و بویراحمد', 30.3592, 50.7981, 84),
              ('دهدشت', 'dehdasht', 'کهگیلویه و بویراحمد', 30.7833, 50.5667, 85)
    `);

    await q.query(`ALTER TABLE salons ADD COLUMN city_id int NULL REFERENCES cities(id) ON DELETE SET NULL`);
    await q.query(`CREATE INDEX salons_city_id_idx ON salons(city_id)`);

    // Best-effort backfill: link every existing salon whose free-text city column
    // exactly matches one of the canonical names above. No fuzzy matching -- a
    // near-miss (different spelling/transliteration) is left NULL rather than risking
    // a wrong link, consistent with the "purely additive enrichment" framing above.
    await q.query(`
      UPDATE salons SET city_id = cities.id
      FROM cities
      WHERE salons.city = cities.name AND salons.city_id IS NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE salons DROP COLUMN city_id`);
    await q.query(`DROP TABLE cities`);
  }
}

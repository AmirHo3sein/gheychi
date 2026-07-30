import { randomBytes } from 'crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not, Repository, SelectQueryBuilder } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { Salon } from '../salons/salon.entity';
import { Worker } from '../salons/worker.entity';
import { User } from '../users/user.entity';
import { WalletCurrency } from '../wallet/wallet-balance.entity';
import { WalletService } from '../wallet/wallet.service';
import { UpdateReferralRewardTypeDto } from './dto/referral.dto';
import { ReferralCode } from './referral-code.entity';
import { QualifyingEvent, ReferralRewardType, ReferralType, RewardKind } from './referral-reward-type.entity';
import { ReferralReward, ReferralRewardStatus, RewardBeneficiaryRole } from './referral-reward.entity';
import { Referral, ReferralStatus } from './referral.entity';

// Every status other than 'applied' means NOTHING was persisted -- no `referrals` row
// exists and, since redemption is only reachable on the isNew branch of verify-otp against
// a UNIQUE referred_user_id, no later request can attach the code to this account. The two
// no-row causes are kept apart (rather than both reported as 'referral_type_disabled', as
// they were until this fix) because they need different words for the invitee: the reward
// type being off is a platform-wide state, a spent cap belongs to that one referrer.
export type ReferralApplyStatus = 'applied' | 'invalid_code' | 'referral_type_disabled' | 'referrer_limit_reached';

// Reward-kind support as of Slice 6: ALL FIVE reward kinds are now supported for both
// beneficiary sides. wallet_credit/cashback/loyalty_points pay out as a
// wallet_transactions credit (Slice 4); percent_discount and fixed_discount both pay
// out as a literal, user-restricted `coupons` row (percent_discount since Slice 5,
// fixed_discount newly here via coupons.discount_fixed_amount + issueReferralCoupon's
// kind/value parameterization -- spec section 3/10). A referral can now ALWAYS reach
// 'reward_granted' (never permanently stuck at 'partially_granted') as long as an
// admin has configured both sides to a supported kind, which by this slice is every
// kind that exists.

// Referral-issued coupon codes are prefixed for support/admin recognizability (spec
// section 3) -- the random body reuses the exact same alphabet/length/collision-retry
// shape as CODE_ALPHABET/CODE_LENGTH/MAX_CODE_GEN_ATTEMPTS below (createCodeForUser),
// just with a different prefix and a different target table.
const REFERRAL_COUPON_PREFIX = 'REF-';
// Placeholder redemption window used only when the referral itself has no expiry (or
// its expiry has already lapsed by grant time) -- exactly as placeholder as the
// reward amounts themselves are today (Product Decision 1). No product input yet on
// how long an issued referral coupon should live; revisit alongside real reward values.
const REFERRAL_COUPON_DEFAULT_EXPIRY_DAYS = 90;

// Raw shape of a `referrals` row as read back by the plain `SELECT * FROM referrals`
// queries below (snake_case, numeric/timestamp columns not yet coerced by TypeORM's
// entity transformers -- this method deliberately uses em.query, not the repository,
// so the exact same row shape is both the FOR UPDATE lock target and the data read).
interface ReferralRow {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  salon_id: string | null;
  referrer_reward_kind: RewardKind;
  referrer_reward_value: string;
  referrer_reward_max: string | null;
  referred_reward_kind: RewardKind;
  referred_reward_value: string;
  referred_reward_max: string | null;
  qualifying_event: QualifyingEvent;
  grant_holdback_hours: number;
  status: ReferralStatus;
  expires_at: string | null;
}

interface RewardSide {
  role: RewardBeneficiaryRole;
  userId: string;
  kind: RewardKind;
  value: number;
  max: number | null;
}

export interface MyRewardListItem {
  id: string;
  referralId: string;
  beneficiaryRole: RewardBeneficiaryRole;
  rewardKind: RewardKind;
  rewardValue: number;
  status: ReferralRewardStatus;
  grantedAt: Date;
  walletTransactionId: string | null;
  couponId: string | null;
  // Denormalized so the frontend never has to make a second round-trip to
  // /wallet/mine/transactions or a coupon lookup just to render "what did I get" --
  // see the class-level doc comment on getMyRewards for why this was chosen over
  // returning bare ids only.
  currency: WalletCurrency | null;
  couponCode: string | null;
}

export interface MyReferralListItem {
  id: string;
  referredUserPhoneMasked: string;
  status: ReferralStatus;
  referralType: ReferralType;
  createdAt: Date;
  rewardGrantedAt: Date | null;
}

export interface AdminReferralListItem {
  id: string;
  referralType: ReferralType;
  status: ReferralStatus;
  referrerUserId: string;
  referrerPhone: string | null;
  referredUserId: string;
  referredUserPhoneMasked: string;
  salonId: string | null;
  qualifyingEvent: QualifyingEvent;
  expiresAt: Date | null;
  rewardGrantedAt: Date | null;
  cancelledReason: string | null;
  createdAt: Date;
  // Snapshotted reward terms (R5) -- already columns on `referrals`, just not
  // previously projected onto the admin list row (Piece 3 projection fix).
  referrerRewardKind: RewardKind;
  referrerRewardValue: number;
  referrerRewardMax: number | null;
  referredRewardKind: RewardKind;
  referredRewardValue: number;
  referredRewardMax: number | null;
}

// A single referral_rewards row as surfaced to an admin (GET
// /admin/referrals/:id/rewards) -- both beneficiary sides, if present, with enough
// detail to see exactly what happened without a second lookup: the linked wallet
// transaction id, or -- resolved via a join, not just the bare id -- the linked
// coupon's own code and isActive state.
export interface AdminRewardListItem {
  id: string;
  beneficiaryRole: RewardBeneficiaryRole;
  beneficiaryUserId: string;
  rewardKind: RewardKind;
  rewardValue: number;
  status: ReferralRewardStatus;
  grantedAt: Date;
  reversedAt: Date | null;
  reversalReason: string | null;
  reversalShortfallAmount: number | null;
  walletTransactionId: string | null;
  couponId: string | null;
  couponCode: string | null;
  couponIsActive: boolean | null;
}

export interface AdminReferralFilters {
  status?: ReferralStatus;
  referralType?: ReferralType;
  referrerPhone?: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// No uppercase alphanumeric chars that are easy to confuse when relayed verbally/by
// text (0/O, 1/I) -- a referral code is meant to be shared out loud or typed by hand.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const MAX_CODE_GEN_ATTEMPTS = 5;

/** 0912***4567 -- keep the first/last 4 digits, mask everything in between. */
export function maskPhone(phone: string): string {
  if (phone.length <= 8) return phone;
  const visible = 4;
  const maskedLength = phone.length - visible * 2;
  return phone.slice(0, visible) + '*'.repeat(maskedLength) + phone.slice(phone.length - visible);
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    @InjectRepository(ReferralCode) private readonly referralCodes: Repository<ReferralCode>,
    @InjectRepository(ReferralRewardType) private readonly rewardTypes: Repository<ReferralRewardType>,
    @InjectRepository(Referral) private readonly referrals: Repository<Referral>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(Worker) private readonly workers: Repository<Worker>,
    private readonly config: ConfigService,
    // Appended at the end (rather than interleaved) so every existing positional
    // `new ReferralsService(...)` call site only needs new args added at the tail,
    // not threaded through the middle.
    @InjectRepository(ReferralReward) private readonly referralRewards: Repository<ReferralReward>,
    private readonly dataSource: DataSource,
    private readonly wallet: WalletService,
    private readonly alerts: AlertsService,
  ) {}

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private generateCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
  }

  private buildShareUrl(code: string): string {
    const frontendBase = this.config.get('FRONTEND_BASE_URL', 'http://localhost:3003');
    return `${frontendBase}/login?ref=${code}`;
  }

  /**
   * Lazily mints a referral_codes row for a user on first call. Retry-loop-on-
   * unique-violation, same defensive collision-retry shape used elsewhere in this
   * codebase for generated codes (see makeSlug's random-suffix idiom in
   * common/slug.util.ts). A unique violation here can be either the random `code`
   * colliding (retry with a fresh one) or a concurrent caller already minting this
   * exact user's lifetime code (owner_user_id is also UNIQUE) -- either way, re-check
   * for the row before giving up.
   */
  private async createCodeForUser(userId: string): Promise<ReferralCode> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_CODE_GEN_ATTEMPTS; attempt++) {
      try {
        return await this.referralCodes.save(
          this.referralCodes.create({ ownerUserId: userId, code: this.generateCode() }),
        );
      } catch (err) {
        lastErr = err;
        if (!isUniqueViolation(err)) throw err;
        const existing = await this.referralCodes.findOneBy({ ownerUserId: userId });
        if (existing) return existing;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Failed to generate a unique referral code');
  }

  /**
   * Issues a literal, user-restricted `coupons` row for a percent_discount OR
   * fixed_discount referral reward side (spec section 2/3; percent_discount since
   * Slice 5, fixed_discount since Slice 6) -- called from inside tryGrantReward's
   * transaction, using the SAME em so the coupon insert commits or rolls back with
   * everything else in that grant attempt. Collision-retried against coupons.code
   * UNIQUE, mirroring createCodeForUser's retry-on-unique-violation shape above
   * (same alphabet/length, different prefix/target table). If this throws after
   * exhausting retries, the whole tryGrantReward transaction rolls back -- the next
   * sweep pass simply retries this side, same as any other failure path already
   * wired into that method.
   *
   * `kind`/`value` decide which of the two mutually-exclusive coupon columns get
   * populated -- the other is always bound NULL in the same INSERT, so the row can
   * never violate coupons_discount_shape_chk (Slice 6). Never both, never neither.
   */
  private async issueReferralCoupon(
    em: EntityManager,
    referral: ReferralRow,
    beneficiaryUserId: string,
    kind: 'percent_discount' | 'fixed_discount',
    resolvedValue: number,
  ): Promise<string> {
    // R8: use the referral's own expiry if it's set and still in the future at grant
    // time; otherwise fall back to the placeholder redemption window (see
    // REFERRAL_COUPON_DEFAULT_EXPIRY_DAYS above).
    const referralExpiry = referral.expires_at ? new Date(referral.expires_at) : null;
    const expiresAt =
      referralExpiry && referralExpiry.getTime() > Date.now()
        ? referralExpiry
        : new Date(Date.now() + REFERRAL_COUPON_DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const discountPercent = kind === 'percent_discount' ? resolvedValue : null;
    const discountFixedAmount = kind === 'fixed_discount' ? resolvedValue : null;

    // salon_id: reused DIRECTLY from the referrals row (NULL for user-type referrals,
    // the referring salon's id for salon_owner/worker-type ones) -- already resolved
    // and snapshotted onto this row by applyReferralAtRegistration, not re-derived
    // here (spec section 2, Slice 5).
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_CODE_GEN_ATTEMPTS; attempt++) {
      try {
        const inserted: Array<{ id: string }> = await em.query(
          `INSERT INTO coupons (code, salon_id, discount_percent, discount_fixed_amount, is_active, max_redemptions, expires_at, issued_to_user_id)
           VALUES ($1, $2, $3, $4, true, 1, $5, $6) RETURNING id`,
          [
            `${REFERRAL_COUPON_PREFIX}${this.generateCode()}`,
            referral.salon_id,
            discountPercent,
            discountFixedAmount,
            expiresAt,
            beneficiaryUserId,
          ],
        );
        return inserted[0].id;
      } catch (err) {
        lastErr = err;
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Failed to generate a unique referral discount coupon code');
  }

  async getOrCreateMyCode(userId: string): Promise<{ code: string; isActive: boolean; shareUrl: string }> {
    const referralCode = (await this.referralCodes.findOneBy({ ownerUserId: userId })) ?? (await this.createCodeForUser(userId));
    return {
      code: referralCode.code,
      isActive: referralCode.disabledAt === null,
      shareUrl: this.buildShareUrl(referralCode.code),
    };
  }

  /** Public, read-only. Reveals nothing about the code's owner (spec section 4/7). */
  async validateCode(code: string): Promise<{ valid: boolean }> {
    const found = await this.referralCodes.findOneBy({ code: this.normalizeCode(code), disabledAt: IsNull() });
    return { valid: !!found };
  }

  /**
   * Resolves a user's CURRENT role at this instant (Product Decision 3): active
   * worker beats salon owner beats plain user. `em` is passed when this runs inside
   * the registration transaction; omitted for any future read-only caller (e.g. an
   * admin preview), in which case it falls back to the injected repositories.
   */
  async resolveReferralType(userId: string, em?: EntityManager): Promise<ReferralType> {
    const workerRepo = em ? em.getRepository(Worker) : this.workers;
    const activeWorker = await workerRepo.findOneBy({ userId, active: true });
    if (activeWorker) return 'worker';

    const salonRepo = em ? em.getRepository(Salon) : this.salons;
    const ownedSalon = await salonRepo.findOneBy({ ownerId: userId });
    if (ownedSalon) return 'salon_owner';

    return 'user';
  }

  private async resolveSalonId(referralType: ReferralType, ownerUserId: string, em: EntityManager): Promise<string | null> {
    if (referralType === 'salon_owner') {
      const salon = await em.getRepository(Salon).findOneBy({ ownerId: ownerUserId });
      return salon?.id ?? null;
    }
    if (referralType === 'worker') {
      const worker = await em.getRepository(Worker).findOneBy({ userId: ownerUserId, active: true });
      return worker?.salonId ?? null;
    }
    return null;
  }

  /**
   * Called ONLY from the isNew branch of registration, inside the same transaction
   * that just created the new user row. Must never throw -- the caller (AuthController)
   * also wraps this defensively, but the one query here that can actually fail
   * (the referrals insert) is additionally isolated behind a SAVEPOINT so a caught
   * unique-violation doesn't poison the enclosing transaction (which still needs to
   * commit the new user row regardless of what happens here).
   */
  async applyReferralAtRegistration(newUserId: string, code: string, em: EntityManager): Promise<{ status: ReferralApplyStatus }> {
    const referralCode = await em
      .getRepository(ReferralCode)
      .findOneBy({ code: this.normalizeCode(code), disabledAt: IsNull() });
    if (!referralCode) return { status: 'invalid_code' };

    // Cannot actually happen at registration (the referrer must already exist for
    // their code to be enterable), but guarded defensively per spec rather than ever
    // letting a redemption resolve to its own owner.
    if (referralCode.ownerUserId === newUserId) return { status: 'invalid_code' };

    const referralType = await this.resolveReferralType(referralCode.ownerUserId, em);
    const rewardType = await em.getRepository(ReferralRewardType).findOneBy({ referralType });
    if (!rewardType || !rewardType.enabled) return { status: 'referral_type_disabled' };

    // R10 -- max_referrals_per_referrer, enforced at REDEMPTION time (i.e. right here),
    // not at grant time. Terms are otherwise always snapshotted at redemption and never
    // re-read live (R5); this cap is no different -- it's a policy gate on whether a NEW
    // redemption is even allowed to happen, which is naturally a redemption-time check,
    // not something tryGrantReward should be discovering after the fact.
    //
    // Row-lock the referral code for the rest of this transaction FIRST, so that
    // concurrent registrations redeeming the SAME code serialize against each other --
    // required for this cap to actually be race-safe (R10: "never a separate,
    // race-prone pre-check") rather than a plain count-then-insert two concurrent
    // transactions can both read before either commits. Matches this codebase's
    // existing lock-then-check-then-write idiom (CouponsService.resolveAndValidate's
    // maxRedemptions lock, this file's own tryGrantReward referral-row lock). Verified
    // adversarially: with this lock removed, 8 concurrent registrations against a
    // cap of 2 all applied (8 non-cancelled referral rows against a cap of 2).
    if (rewardType.maxReferralsPerReferrer !== null) {
      await em.query('SELECT id FROM referral_codes WHERE id = $1 FOR UPDATE', [referralCode.id]);
      const existingCount = await em.getRepository(Referral).count({
        where: {
          referrerUserId: referralCode.ownerUserId,
          referralType,
          // A cancelled referral never counts against the cap -- it produced no
          // reward and was explicitly voided by an admin.
          status: Not('cancelled'),
        },
      });
      // Its own status, not 'referral_type_disabled': the referral system is working fine
      // here, this one referrer has simply spent their quota -- and the invitee is told
      // exactly that instead of a message about rewards not being enabled yet.
      if (existingCount >= rewardType.maxReferralsPerReferrer) return { status: 'referrer_limit_reached' };
    }

    const salonId = await this.resolveSalonId(referralType, referralCode.ownerUserId, em);
    const expiresAt =
      rewardType.expirationDays !== null ? new Date(Date.now() + rewardType.expirationDays * 24 * 60 * 60 * 1000) : null;

    await em.query('SAVEPOINT referral_apply');
    try {
      await em.getRepository(Referral).insert({
        referralCodeId: referralCode.id,
        referrerUserId: referralCode.ownerUserId,
        referredUserId: newUserId,
        referralType,
        salonId,
        referrerRewardKind: rewardType.referrerRewardKind,
        referrerRewardValue: rewardType.referrerRewardValue,
        referrerRewardMax: rewardType.referrerRewardMax,
        referredRewardKind: rewardType.referredRewardKind,
        referredRewardValue: rewardType.referredRewardValue,
        referredRewardMax: rewardType.referredRewardMax,
        qualifyingEvent: rewardType.qualifyingEvent,
        grantHoldbackHours: rewardType.grantHoldbackHours,
        status: 'awaiting_qualifying_event',
        expiresAt,
      });
      await em.query('RELEASE SAVEPOINT referral_apply');
    } catch (err) {
      await em.query('ROLLBACK TO SAVEPOINT referral_apply');
      // referred_user_id UNIQUE -- belt-and-suspenders against a double-call for the
      // same brand-new user; treated as an idempotent no-op, never a throw.
      if (isUniqueViolation(err)) return { status: 'invalid_code' };
      throw err;
    }

    return { status: 'applied' };
  }

  async listMine(userId: string, page = 1, pageSize = 20): Promise<Page<MyReferralListItem>> {
    const qb = this.referrals
      .createQueryBuilder('referral')
      .leftJoin(User, 'referredUser', 'referredUser.id = referral.referredUserId')
      .select('referral.id', 'id')
      .addSelect('referredUser.phone', 'referredUserPhone')
      .addSelect('referral.status', 'status')
      .addSelect('referral.referralType', 'referralType')
      .addSelect('referral.createdAt', 'createdAt')
      .addSelect('referral.rewardGrantedAt', 'rewardGrantedAt')
      .where('referral.referrerUserId = :userId', { userId })
      .orderBy('referral.createdAt', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize);

    const [rows, total] = await Promise.all([
      qb.getRawMany<{
        id: string;
        referredUserPhone: string;
        status: ReferralStatus;
        referralType: ReferralType;
        createdAt: Date;
        rewardGrantedAt: Date | null;
      }>(),
      this.referrals.count({ where: { referrerUserId: userId } }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        referredUserPhoneMasked: maskPhone(r.referredUserPhone),
        status: r.status,
        referralType: r.referralType,
        createdAt: r.createdAt,
        rewardGrantedAt: r.rewardGrantedAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  async listForAdmin(filters: AdminReferralFilters, page = 1, pageSize = 20): Promise<Page<AdminReferralListItem>> {
    const applyFilters = <T extends SelectQueryBuilder<Referral>>(qb: T): T => {
      if (filters.status) qb.andWhere('referral.status = :status', { status: filters.status });
      if (filters.referralType) qb.andWhere('referral.referralType = :referralType', { referralType: filters.referralType });
      if (filters.referrerPhone) qb.andWhere('referrer.phone = :referrerPhone', { referrerPhone: filters.referrerPhone });
      return qb;
    };

    const qb = applyFilters(
      this.referrals
        .createQueryBuilder('referral')
        .leftJoin(User, 'referrer', 'referrer.id = referral.referrerUserId')
        .leftJoin(User, 'referred', 'referred.id = referral.referredUserId')
        .select('referral.id', 'id')
        .addSelect('referral.referralType', 'referralType')
        .addSelect('referral.status', 'status')
        .addSelect('referral.referrerUserId', 'referrerUserId')
        .addSelect('referrer.phone', 'referrerPhone')
        .addSelect('referral.referredUserId', 'referredUserId')
        .addSelect('referred.phone', 'referredUserPhone')
        .addSelect('referral.salonId', 'salonId')
        .addSelect('referral.qualifyingEvent', 'qualifyingEvent')
        .addSelect('referral.expiresAt', 'expiresAt')
        .addSelect('referral.rewardGrantedAt', 'rewardGrantedAt')
        .addSelect('referral.cancelledReason', 'cancelledReason')
        .addSelect('referral.createdAt', 'createdAt')
        // Piece 3 projection fix: these were already columns on `referrals` (the
        // snapshot R5 guarantees), just never selected/returned to the admin list.
        .addSelect('referral.referrerRewardKind', 'referrerRewardKind')
        .addSelect('referral.referrerRewardValue', 'referrerRewardValue')
        .addSelect('referral.referrerRewardMax', 'referrerRewardMax')
        .addSelect('referral.referredRewardKind', 'referredRewardKind')
        .addSelect('referral.referredRewardValue', 'referredRewardValue')
        .addSelect('referral.referredRewardMax', 'referredRewardMax')
        .orderBy('referral.createdAt', 'DESC')
        .offset((page - 1) * pageSize)
        .limit(pageSize),
    );

    const countQb = applyFilters(
      this.referrals.createQueryBuilder('referral').leftJoin(User, 'referrer', 'referrer.id = referral.referrerUserId'),
    );

    const [rows, total] = await Promise.all([
      qb.getRawMany<{
        id: string;
        referralType: ReferralType;
        status: ReferralStatus;
        referrerUserId: string;
        referrerPhone: string | null;
        referredUserId: string;
        referredUserPhone: string;
        salonId: string | null;
        qualifyingEvent: QualifyingEvent;
        expiresAt: Date | null;
        rewardGrantedAt: Date | null;
        cancelledReason: string | null;
        createdAt: Date;
        referrerRewardKind: RewardKind;
        referrerRewardValue: string;
        referrerRewardMax: string | null;
        referredRewardKind: RewardKind;
        referredRewardValue: string;
        referredRewardMax: string | null;
      }>(),
      countQb.getCount(),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        referralType: r.referralType,
        status: r.status,
        referrerUserId: r.referrerUserId,
        referrerPhone: r.referrerPhone,
        referredUserId: r.referredUserId,
        referredUserPhoneMasked: maskPhone(r.referredUserPhone),
        salonId: r.salonId,
        qualifyingEvent: r.qualifyingEvent,
        expiresAt: r.expiresAt,
        rewardGrantedAt: r.rewardGrantedAt,
        cancelledReason: r.cancelledReason,
        createdAt: r.createdAt,
        referrerRewardKind: r.referrerRewardKind,
        referrerRewardValue: Number(r.referrerRewardValue),
        referrerRewardMax: r.referrerRewardMax === null ? null : Number(r.referrerRewardMax),
        referredRewardKind: r.referredRewardKind,
        referredRewardValue: Number(r.referredRewardValue),
        referredRewardMax: r.referredRewardMax === null ? null : Number(r.referredRewardMax),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Admin-only (Piece 3). This referral's referral_rewards rows, either beneficiary
   * role, in grant order -- enough detail for an admin to see exactly what happened
   * to a referral without a second lookup per row: the linked wallet transaction id
   * as-is, or -- resolved via a join, not just the bare id -- the linked coupon's own
   * code and current isActive state. 404s if the referral itself doesn't exist; an
   * empty array is a valid, normal response for a referral still
   * awaiting_qualifying_event (no rewards granted yet).
   */
  async getRewardsForAdmin(referralId: string): Promise<AdminRewardListItem[]> {
    const referral = await this.referrals.findOneBy({ id: referralId });
    if (!referral) throw new NotFoundException('Referral not found');

    const rows = await this.referralRewards
      .createQueryBuilder('reward')
      .leftJoin('coupons', 'c', 'c.id = reward.couponId')
      .select('reward.id', 'id')
      .addSelect('reward.beneficiaryRole', 'beneficiaryRole')
      .addSelect('reward.beneficiaryUserId', 'beneficiaryUserId')
      .addSelect('reward.rewardKind', 'rewardKind')
      .addSelect('reward.rewardValue', 'rewardValue')
      .addSelect('reward.status', 'status')
      .addSelect('reward.grantedAt', 'grantedAt')
      .addSelect('reward.reversedAt', 'reversedAt')
      .addSelect('reward.reversalReason', 'reversalReason')
      .addSelect('reward.reversalShortfallAmount', 'reversalShortfallAmount')
      .addSelect('reward.walletTransactionId', 'walletTransactionId')
      .addSelect('reward.couponId', 'couponId')
      .addSelect('c.code', 'couponCode')
      .addSelect('c.isActive', 'couponIsActive')
      .where('reward.referralId = :referralId', { referralId })
      .orderBy('reward.grantedAt', 'ASC')
      .getRawMany<{
        id: string;
        beneficiaryRole: RewardBeneficiaryRole;
        beneficiaryUserId: string;
        rewardKind: RewardKind;
        rewardValue: string;
        status: ReferralRewardStatus;
        grantedAt: Date;
        reversedAt: Date | null;
        reversalReason: string | null;
        reversalShortfallAmount: string | null;
        walletTransactionId: string | null;
        couponId: string | null;
        couponCode: string | null;
        couponIsActive: boolean | null;
      }>();

    return rows.map((r) => ({
      id: r.id,
      beneficiaryRole: r.beneficiaryRole,
      beneficiaryUserId: r.beneficiaryUserId,
      rewardKind: r.rewardKind,
      rewardValue: Number(r.rewardValue),
      status: r.status,
      grantedAt: r.grantedAt,
      reversedAt: r.reversedAt,
      reversalReason: r.reversalReason,
      reversalShortfallAmount: r.reversalShortfallAmount === null ? null : Number(r.reversalShortfallAmount),
      walletTransactionId: r.walletTransactionId,
      couponId: r.couponId,
      couponCode: r.couponCode,
      couponIsActive: r.couponIsActive,
    }));
  }

  /**
   * Admin-only. Only transitions from 'awaiting_qualifying_event' -> 'cancelled' --
   * conditional UPDATE, same lost-race idiom as SalonsService.resubmitMine()/
   * ReportsService.resolve(). 404 if the referral doesn't exist at all, 409 if it
   * exists but is no longer in the cancellable state (already granted/expired/
   * cancelled, including by a racing concurrent call).
   */
  async cancel(id: string, reason: string): Promise<Referral> {
    const result = await this.referrals.update(
      { id, status: 'awaiting_qualifying_event' },
      { status: 'cancelled', cancelledReason: reason },
    );
    if (!result.affected) {
      const existing = await this.referrals.findOneBy({ id });
      if (!existing) throw new NotFoundException('Referral not found');
      throw new ConflictException('این ارجاع دیگر در وضعیت در انتظار رویداد نیست');
    }
    return (await this.referrals.findOneBy({ id }))!;
  }

  listRewardTypes(): Promise<ReferralRewardType[]> {
    return this.rewardTypes.find({ order: { referralType: 'ASC' } });
  }

  /**
   * Admin-only, PATCH-style partial update. R5 already guarantees this has no
   * retroactive effect on existing referrals (their terms were snapshotted at
   * redemption) -- deliberately no logic here touches the `referrals` table.
   */
  async updateRewardType(referralType: ReferralType, dto: UpdateReferralRewardTypeDto): Promise<ReferralRewardType> {
    const patch: Partial<ReferralRewardType> = { updatedAt: new Date() };
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.referrerRewardKind !== undefined) patch.referrerRewardKind = dto.referrerRewardKind;
    if (dto.referrerRewardValue !== undefined) patch.referrerRewardValue = dto.referrerRewardValue;
    if (dto.referrerRewardMax !== undefined) patch.referrerRewardMax = dto.referrerRewardMax;
    if (dto.referredRewardKind !== undefined) patch.referredRewardKind = dto.referredRewardKind;
    if (dto.referredRewardValue !== undefined) patch.referredRewardValue = dto.referredRewardValue;
    if (dto.referredRewardMax !== undefined) patch.referredRewardMax = dto.referredRewardMax;
    if (dto.qualifyingEvent !== undefined) patch.qualifyingEvent = dto.qualifyingEvent;
    if (dto.grantHoldbackHours !== undefined) patch.grantHoldbackHours = dto.grantHoldbackHours;
    if (dto.expirationDays !== undefined) patch.expirationDays = dto.expirationDays;
    if (dto.maxReferralsPerReferrer !== undefined) patch.maxReferralsPerReferrer = dto.maxReferralsPerReferrer;

    const result = await this.rewardTypes.update({ referralType }, patch);
    if (!result.affected) throw new NotFoundException('Referral reward type not found');
    return (await this.rewardTypes.findOneBy({ referralType }))!;
  }

  /**
   * The core money-moving transaction (spec section 7). Called from two trigger
   * points: BookingsService.updateStatus's 'completed' branch (inline, eventType
   * 'completed'), and ReferralGrantJob's hourly sweep (eventType 'paid', after R7's
   * hold-back window has plausibly elapsed).
   *
   * A referral has two independent beneficiary sides (referrer/referred), each
   * backed by its own referral_rewards row (UNIQUE(referral_id, beneficiary_role)).
   * Granting is per-side and idempotent: a side with an existing referral_rewards row
   * is skipped (already granted, whether by an earlier call to this same method or a
   * concurrent racer that won). As of Slice 6, ALL FIVE reward kinds are supported for
   * both sides (wallet_credit/cashback/loyalty_points -> wallet; percent_discount/
   * fixed_discount -> coupon) -- a referral can now ALWAYS reach 'reward_granted' (in
   * one pass, both sides at once) as long as an admin configured both sides to a
   * supported kind, which by this slice is every kind. The 'partially_granted' branch
   * below is kept as defense-in-depth for any future reward kind added without
   * corresponding grant logic, and for re-visiting a referral that was already
   * partially granted by an OLDER build of this method before this slice shipped.
   * After attempting both sides: 2 rows total -> 'reward_granted'; exactly 1 ->
   * 'partially_granted'; 0 -> status left untouched.
   *
   * NEVER throws out of this method -- this runs inline inside booking-completion and
   * payment-confirmation flows that must not fail because a reward couldn't be
   * granted. Unexpected failures are logged and paged via AlertsService (this moves
   * real money) rather than surfaced to the caller.
   */
  async tryGrantReward(referredUserId: string, triggeringBookingId: string, eventType: 'completed' | 'paid'): Promise<void> {
    try {
      await this.dataSource.transaction(async (em) => {
        // The actual serialization point: a referral is found via its UNIQUE
        // referred_user_id, so this FOR UPDATE lock means no two concurrent calls for
        // the same referred user (webhook retry racing the hourly sweep, e.g.) can
        // both proceed past this line.
        const rows: ReferralRow[] = await em.query(`SELECT * FROM referrals WHERE referred_user_id = $1 FOR UPDATE`, [
          referredUserId,
        ]);
        const referral = rows[0];
        if (!referral) return; // never referred -- no-op

        // Only these two states are actionable. 'reward_granted'/'expired'/'cancelled'
        // are terminal; a call landing here for one of those is a guaranteed idempotent
        // no-op (e.g. a duplicate webhook, or the sweep re-visiting a referral this
        // exact call already fully granted moments ago).
        if (referral.status !== 'awaiting_qualifying_event' && referral.status !== 'partially_granted') return;

        const mappedEvent: QualifyingEvent = eventType === 'completed' ? 'first_completed_booking' : 'first_paid_booking';
        if (referral.qualifying_event !== mappedEvent) return;

        if (referral.expires_at && new Date(referral.expires_at) < new Date()) return; // let a future expiry sweep flip it

        if (referral.qualifying_event === 'first_paid_booking') {
          const paymentRows: Array<{ status: string; paid_at: string | null }> = await em.query(
            `SELECT status, paid_at FROM payments WHERE booking_id = $1`,
            [triggeringBookingId],
          );
          const payment = paymentRows[0];
          // Not (or no longer) 'paid' -- refunded/refund_pending/failed since the
          // triggering event fired, or somehow missing. Do not grant against money
          // that isn't safely captured; the referral stays put for a later retry to
          // re-evaluate against whatever the payment's state is by then.
          if (!payment || payment.status !== 'paid' || !payment.paid_at) return;
          const paidAgeMs = Date.now() - new Date(payment.paid_at).getTime();
          if (paidAgeMs < referral.grant_holdback_hours * 3600_000) return; // R7 -- too soon, try again next pass
        }

        // Upsert-then-lock BOTH of the referrer's wallet_balances rows (toman AND
        // points) up front, before either side of the grant is processed. This is not
        // strictly required for correctness of a single credit() call (WalletService
        // already row-locks the one row it writes), but it serializes this entire
        // two-sided grant attempt against any other concurrent referral crediting the
        // SAME referrer (e.g. two different people who both referred one prolific
        // referrer, whose qualifying bookings happen to complete moments apart) for
        // the full duration of this transaction, not just the instant of each
        // individual credit() write.
        await em.query(
          `INSERT INTO wallet_balances (user_id, currency, balance) VALUES ($1, 'toman', 0), ($1, 'points', 0)
           ON CONFLICT (user_id, currency) DO NOTHING`,
          [referral.referrer_user_id],
        );
        await em.query(`SELECT user_id FROM wallet_balances WHERE user_id = $1 FOR UPDATE`, [referral.referrer_user_id]);

        const sides: RewardSide[] = [
          {
            role: 'referrer',
            userId: referral.referrer_user_id,
            kind: referral.referrer_reward_kind,
            value: Number(referral.referrer_reward_value),
            max: referral.referrer_reward_max === null ? null : Number(referral.referrer_reward_max),
          },
          {
            role: 'referred',
            userId: referral.referred_user_id,
            kind: referral.referred_reward_kind,
            value: Number(referral.referred_reward_value),
            max: referral.referred_reward_max === null ? null : Number(referral.referred_reward_max),
          },
        ];

        for (const side of sides) {
          // Idempotent: a side that already has a referral_rewards row (granted by an
          // earlier call, or by a concurrent racer that inserted first) is skipped.
          // UNIQUE(referral_id, beneficiary_role) backstops this even if two
          // transactions somehow both reach this point (they can't -- the referrals
          // row FOR UPDATE lock above already fully serializes them -- but the
          // constraint is kept as the transaction-independent belt-and-suspenders the
          // spec calls for).
          const existing = await em.query(
            `SELECT id FROM referral_rewards WHERE referral_id = $1 AND beneficiary_role = $2`,
            [referral.id, side.role],
          );
          if (existing.length > 0) continue;

          let resolvedValue = side.max !== null ? Math.min(side.value, side.max) : side.value;
          if (side.kind === 'percent_discount' || side.kind === 'fixed_discount') {
            // coupons.discount_percent is an int column and coupons.discount_fixed_amount
            // is a bigint column -- round once here so the referral_rewards.reward_value
            // snapshot and the actual coupon's discount agree exactly (the
            // numeric(12,2) reward-type value could otherwise carry a fractional
            // toman/percent that neither target column can represent).
            resolvedValue = Math.round(resolvedValue);
          }

          const insertedReward = await em.query(
            `INSERT INTO referral_rewards (referral_id, beneficiary_user_id, beneficiary_role, reward_kind, reward_value, status)
             VALUES ($1, $2, $3, $4, $5, 'granted') RETURNING id`,
            [referral.id, side.userId, side.role, side.kind, resolvedValue],
          );
          const rewardId = insertedReward[0].id as string;

          if (side.kind === 'percent_discount' || side.kind === 'fixed_discount') {
            // Discount-kind payout: a literal, user-restricted coupons row (spec
            // section 2/3) rather than a wallet movement. percent_discount since
            // Slice 5, fixed_discount since Slice 6 -- both funnel through the same
            // issueReferralCoupon helper, which binds exactly one of
            // coupons.discount_percent/discount_fixed_amount per the DB's
            // coupons_discount_shape_chk constraint.
            const couponId = await this.issueReferralCoupon(em, referral, side.userId, side.kind, resolvedValue);
            await em.query(`UPDATE referral_rewards SET coupon_id = $2 WHERE id = $1`, [rewardId, couponId]);
          } else {
            // wallet_credit / cashback / loyalty_points -- wallet payout (Slice 4).
            const currency: WalletCurrency = side.kind === 'loyalty_points' ? 'points' : 'toman';
            const { transactionId } = await this.wallet.credit(em, side.userId, currency, resolvedValue, 'referral_reward', {
              referenceType: 'referral_reward',
              referenceId: rewardId,
              reason: `پاداش معرفی (${side.role === 'referrer' ? 'معرف' : 'معرفی‌شده'}) برای ارجاع ${referral.id}`,
            });
            await em.query(`UPDATE referral_rewards SET wallet_transaction_id = $2 WHERE id = $1`, [rewardId, transactionId]);
          }
        }

        const countRows: Array<{ c: string }> = await em.query(
          `SELECT COUNT(*)::int AS c FROM referral_rewards WHERE referral_id = $1`,
          [referral.id],
        );
        const grantedCount = Number(countRows[0].c);

        if (grantedCount === 2) {
          // Both sides now have a reward row -- fully granted. Conditional UPDATE
          // (defense-in-depth, same idiom as every other conditional status flip in
          // this codebase) covers both source states: a fresh full grant straight from
          // 'awaiting_qualifying_event', or completing a previously 'partially_granted'
          // referral once the remaining side became grantable.
          await em.query(
            `UPDATE referrals SET status = 'reward_granted', reward_granted_at = now(), qualifying_booking_id = $2
             WHERE id = $1 AND status IN ('awaiting_qualifying_event', 'partially_granted')`,
            [referral.id, triggeringBookingId],
          );
        } else if (grantedCount === 1) {
          // Exactly one side granted. Only transition FROM 'awaiting_qualifying_event'
          // -- a referral already 'partially_granted' re-attempting its still-unsupported
          // side (and finding it still unsupported) must not needlessly rewrite its own
          // row every sweep tick.
          await em.query(
            `UPDATE referrals SET status = 'partially_granted', qualifying_booking_id = $2
             WHERE id = $1 AND status = 'awaiting_qualifying_event'`,
            [referral.id, triggeringBookingId],
          );
        }
        // grantedCount === 0: both sides' kinds are currently unsupported (an admin
        // could set both referrer/referred to a discount kind) -- leave status exactly
        // as it was; nothing was granted, so nothing to record yet.
      });
    } catch (err) {
      this.logger.error(
        `tryGrantReward failed for referred user ${referredUserId} (triggering booking ${triggeringBookingId}, event ${eventType}): ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.alerts.raise({
        key: `referral-grant-failed:${referredUserId}:${triggeringBookingId}`,
        severity: 'critical',
        title: 'اعطای پاداش معرفی ناموفق',
        body: `تلاش برای اعطای پاداش معرفی برای کاربر ${referredUserId} (رزرو ${triggeringBookingId}) با خطا مواجه شد و نیاز به بررسی دستی دارد.`,
      });
    }
  }

  /**
   * Called when a booking's payment is CONFIRMED refunded (status actually flips to
   * 'refunded', not merely refund_pending) -- from PaymentsService.attemptRefund,
   * the single place in this codebase that performs that transition (both the inline
   * cancel-time attempt and RefundRetryJob funnel through it). Idempotent: only rows
   * still `status = 'granted'` are selected, so a second call for the same booking
   * (e.g. a defensive re-check) finds nothing left to reverse and no-ops cleanly --
   * no double-debit is possible.
   */
  async reverseIfNeeded(bookingId: string): Promise<void> {
    try {
      await this.dataSource.transaction(async (em) => {
        const referralRows: Array<{ id: string }> = await em.query(
          `SELECT id FROM referrals WHERE qualifying_booking_id = $1 AND status IN ('reward_granted', 'partially_granted') FOR UPDATE`,
          [bookingId],
        );
        if (referralRows.length === 0) return; // no referral tied to this booking -- safe no-op

        for (const referral of referralRows) {
          const rewardRows: Array<{
            id: string;
            beneficiary_user_id: string;
            reward_kind: RewardKind;
            reward_value: string;
            wallet_transaction_id: string | null;
            coupon_id: string | null;
          }> = await em.query(
            `SELECT id, beneficiary_user_id, reward_kind, reward_value, wallet_transaction_id, coupon_id
             FROM referral_rewards WHERE referral_id = $1 AND status = 'granted' FOR UPDATE`,
            [referral.id],
          );

          for (const reward of rewardRows) {
            if (reward.wallet_transaction_id) {
              const currency: WalletCurrency = reward.reward_kind === 'loyalty_points' ? 'points' : 'toman';
              const { debited, shortfall } = await this.wallet.debit(
                em,
                reward.beneficiary_user_id,
                currency,
                Number(reward.reward_value),
                'referral_reversal',
                {
                  referenceType: 'referral_reward',
                  referenceId: reward.id,
                  reason: `بازگشت پاداش معرفی به دلیل استرداد پرداخت رزرو ${bookingId} (ارجاع ${referral.id})`,
                },
              );

              await em.query(
                `UPDATE referral_rewards
                 SET status = 'reversed', reversed_at = now(), reversal_reason = $2, reversal_shortfall_amount = $3
                 WHERE id = $1`,
                [reward.id, `استرداد پرداخت رزرو ${bookingId}`, shortfall > 0 ? shortfall : null],
              );

              if (shortfall > 0) {
                // R11: the debit was capped at the beneficiary's available balance --
                // they'd already spent/withdrawn past the reward amount before this
                // clawback could run. Real, uncollected money the platform is now
                // short -- same severity tier as a stuck refund (spec section 6, edge
                // case 2).
                await this.alerts.raise({
                  key: `referral-reward-shortfall:${reward.id}`,
                  severity: 'critical',
                  title: 'کسری در بازگشت پاداش معرفی',
                  body: `بازگشت پاداش معرفی ${reward.id} (ارجاع ${referral.id}) با کسری ${shortfall} مواجه شد -- فقط ${debited} از موجودی کاربر ${reward.beneficiary_user_id} قابل کسر بود.`,
                });
              }
            } else if (reward.coupon_id) {
              // Discount-kind reversal (Slice 5 -- percent_discount rewards now
              // actually produce coupon_id rows; this branch was scaffolded
              // defensively in Slice 4 and is exercised for real starting here).
              const redemptions: unknown[] = await em.query(
                `SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 LIMIT 1`,
                [reward.coupon_id],
              );
              if (redemptions.length === 0) {
                // Unredeemed -- void it in place, cheap, reuses the existing column.
                await em.query(`UPDATE coupons SET is_active = false WHERE id = $1`, [reward.coupon_id]);
                await em.query(
                  `UPDATE referral_rewards SET status = 'reversed', reversed_at = now(), reversal_reason = $2 WHERE id = $1`,
                  [reward.id, `کد تخفیف استفاده‌نشده به دلیل استرداد پرداخت رزرو ${bookingId} باطل شد`],
                );
              } else {
                // Already redeemed on a distinct, completed booking -- accepted as
                // non-reversible (Product Decision 8 / spec section 6 edge case 2).
                // This is expected, bounded product behavior, not an incident -- log
                // only, deliberately do NOT alert-page (a false "incident" page here
                // would train operators to ignore real ones).
                //
                // Still leave an honest, queryable marker rather than silence:
                // reversal_reason is set to a distinct, greppable Persian string
                // WITHOUT touching status/reversed_at -- this reward genuinely was
                // NOT reversed, so flipping either of those columns would misreport
                // what happened. This deliberately reuses the existing
                // reversal_reason column (spec 1e's own suggested option) instead of
                // adding a new schema column just to distinguish "reversed" from
                // "reversal attempted but declined" -- `status='granted' AND
                // reversal_reason IS NOT NULL` is the queryable signature of this
                // state (see ReferralsService.getRewardsForAdmin for where an admin
                // can see it).
                this.logger.warn(
                  `Referral reward ${reward.id} (referral ${referral.id}) is an already-redeemed discount coupon -- not reversible, left as 'granted'`,
                );
                await em.query(`UPDATE referral_rewards SET reversal_reason = $2 WHERE id = $1`, [
                  reward.id,
                  'غیرقابل بازگشت -- کد از قبل استفاده شده',
                ]);
              }
            }
          }
        }
      });
    } catch (err) {
      this.logger.error(
        `reverseIfNeeded failed for booking ${bookingId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.alerts.raise({
        key: `referral-reversal-failed:${bookingId}`,
        severity: 'critical',
        title: 'بازگشت پاداش معرفی ناموفق',
        body: `تلاش برای بازگشت پاداش‌های معرفی مرتبط با رزرو ${bookingId} با خطا مواجه شد و نیاز به بررسی دستی دارد.`,
      });
    }
  }

  /**
   * My referral_rewards rows, either beneficiary role, newest first. Denormalizes the
   * resulting wallet currency (via wallet_transactions) and coupon code (via coupons)
   * directly into each row instead of returning bare ids -- chosen over making the
   * frontend resolve those separately per row, since both joins are cheap (indexed PK
   * lookups) and a rewards list is exactly the kind of view where "what did I actually
   * get" matters more than a normalized shape.
   */
  async getMyRewards(userId: string, page = 1, pageSize = 20): Promise<Page<MyRewardListItem>> {
    const qb = this.referralRewards
      .createQueryBuilder('reward')
      .leftJoin('wallet_transactions', 'wt', 'wt.id = reward.walletTransactionId')
      .leftJoin('coupons', 'c', 'c.id = reward.couponId')
      .select('reward.id', 'id')
      .addSelect('reward.referralId', 'referralId')
      .addSelect('reward.beneficiaryRole', 'beneficiaryRole')
      .addSelect('reward.rewardKind', 'rewardKind')
      .addSelect('reward.rewardValue', 'rewardValue')
      .addSelect('reward.status', 'status')
      .addSelect('reward.grantedAt', 'grantedAt')
      .addSelect('reward.walletTransactionId', 'walletTransactionId')
      .addSelect('reward.couponId', 'couponId')
      .addSelect('wt.currency', 'currency')
      .addSelect('c.code', 'couponCode')
      .where('reward.beneficiaryUserId = :userId', { userId })
      .orderBy('reward.grantedAt', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize);

    const [rows, total] = await Promise.all([
      qb.getRawMany<{
        id: string;
        referralId: string;
        beneficiaryRole: RewardBeneficiaryRole;
        rewardKind: RewardKind;
        rewardValue: string;
        status: ReferralRewardStatus;
        grantedAt: Date;
        walletTransactionId: string | null;
        couponId: string | null;
        currency: WalletCurrency | null;
        couponCode: string | null;
      }>(),
      this.referralRewards.count({ where: { beneficiaryUserId: userId } }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        referralId: r.referralId,
        beneficiaryRole: r.beneficiaryRole,
        rewardKind: r.rewardKind,
        rewardValue: Number(r.rewardValue),
        status: r.status,
        grantedAt: r.grantedAt,
        walletTransactionId: r.walletTransactionId,
        couponId: r.couponId,
        currency: r.currency,
        couponCode: r.couponCode,
      })),
      total,
      page,
      pageSize,
    };
  }
}

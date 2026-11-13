/**
 * Tests unitaires pour utils/trustScore.js
 * Couvre : computeTrustScore, getTrustScoreBreakdown
 * Aucune dépendance DB — fonctions pures avec Date.now()
 */

const { computeTrustScore, getTrustScoreBreakdown } = require('../../utils/trustScore');

// ---------------------------------------------------------------------------
// Profil minimal valide pour éviter les TypeError
// ---------------------------------------------------------------------------
function basePro(overrides = {}) {
  return {
    user: { avatarUrl: null, emailVerified: false },
    verifiedByAdmin: false,
    portfolio: [],
    description: '',
    decennaleVerified: false,
    averageRating: 0,
    reviewCount: 0,
    completedMissionsCount: 0,
    cancelledMissionsCount: 0,
    complaintsCount: 0,
    createdAt: new Date(),   // very recent → ~0 seniority
    accountType: 'INDIVIDUAL',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
describe('computeTrustScore', () => {
  describe('output range', () => {
    it('returns 0 for a completely empty profile', () => {
      const score = computeTrustScore(basePro());
      expect(score).toBe(0);
    });

    it('score is always >= 0', () => {
      const proWithPenalties = basePro({
        complaintsCount: 50,
        cancelledMissionsCount: 50,
        averageRating: 1,
      });
      const score = computeTrustScore(proWithPenalties, { badReviewCount: 50 });
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('score is always <= 100', () => {
      const perfectPro = basePro({
        user: { avatarUrl: 'http://img.jpg', emailVerified: true },
        verifiedByAdmin: true,
        portfolio: Array(5).fill({}),
        description: 'A'.repeat(60),
        decennaleVerified: true,
        averageRating: 5,
        reviewCount: 10,
        completedMissionsCount: 20,
        cancelledMissionsCount: 0,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 400),  // ~13 months
        accountType: 'ENTREPRISE',
      });
      const score = computeTrustScore(perfectPro, {
        quoteSentCount: 5,
        quoteAcceptedCount: 3,
        goodReviewCount: 5,
        badReviewCount: 0,
        memberQualityRate: 0.9,
      });
      expect(score).toBeLessThanOrEqual(100);
    });

    it('returns an integer (rounded)', () => {
      const score = computeTrustScore(basePro({ description: 'A'.repeat(60) }));
      expect(Number.isInteger(score)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('profile bonuses', () => {
    it('+10 for avatar', () => {
      const without = computeTrustScore(basePro());
      const with_ = computeTrustScore(basePro({ user: { avatarUrl: 'http://img.jpg', emailVerified: false } }));
      expect(with_ - without).toBe(10);
    });

    it('+10 for emailVerified', () => {
      const without = computeTrustScore(basePro());
      const with_ = computeTrustScore(basePro({ user: { avatarUrl: null, emailVerified: true } }));
      expect(with_ - without).toBe(10);
    });

    it('+20 for verifiedByAdmin', () => {
      const without = computeTrustScore(basePro());
      const with_ = computeTrustScore(basePro({ verifiedByAdmin: true }));
      expect(with_ - without).toBe(20);
    });

    it('+15 for portfolio with 3+ items', () => {
      const without = computeTrustScore(basePro({ portfolio: [1, 2] }));
      const with_ = computeTrustScore(basePro({ portfolio: [1, 2, 3] }));
      expect(with_ - without).toBe(15);
    });

    it('no portfolio bonus for exactly 2 items', () => {
      const without = computeTrustScore(basePro({ portfolio: [] }));
      const with2 = computeTrustScore(basePro({ portfolio: [1, 2] }));
      expect(with2 - without).toBe(0);
    });

    it('+5 for description > 50 chars', () => {
      const without = computeTrustScore(basePro({ description: 'short' }));
      const with_ = computeTrustScore(basePro({ description: 'A'.repeat(51) }));
      expect(with_ - without).toBe(5);
    });

    it('no description bonus for exactly 50 chars', () => {
      const without = computeTrustScore(basePro({ description: '' }));
      const with50 = computeTrustScore(basePro({ description: 'A'.repeat(50) }));
      expect(with50 - without).toBe(0);
    });

    it('+10 for decennaleVerified', () => {
      const without = computeTrustScore(basePro());
      const with_ = computeTrustScore(basePro({ decennaleVerified: true }));
      expect(with_ - without).toBe(10);
    });
  });

  // ---------------------------------------------------------------------------
  describe('activity bonuses', () => {
    it('+5 for first quote sent (quoteSentCount > 0)', () => {
      const without = computeTrustScore(basePro(), { quoteSentCount: 0 });
      const with_ = computeTrustScore(basePro(), { quoteSentCount: 1 });
      expect(with_ - without).toBe(5);
    });

    it('+10 for first quote accepted', () => {
      const without = computeTrustScore(basePro(), { quoteAcceptedCount: 0 });
      const with_ = computeTrustScore(basePro(), { quoteAcceptedCount: 1 });
      expect(with_ - without).toBe(10);
    });

    it('+5 per positive review (goodReviewCount), max +25', () => {
      const with5 = computeTrustScore(basePro(), { goodReviewCount: 5 });
      const with6 = computeTrustScore(basePro(), { goodReviewCount: 6 });
      // capped at 25
      expect(with5 - computeTrustScore(basePro(), { goodReviewCount: 0 })).toBe(25);
      expect(with6).toBe(with5);
    });

    it('goodReviewCount via extras overrides auto-calculation', () => {
      const withExtras = computeTrustScore(
        basePro({ averageRating: 4.5, reviewCount: 10 }),
        { goodReviewCount: 2 }
      );
      const without = computeTrustScore(basePro(), { goodReviewCount: 2 });
      expect(withExtras).toBe(without);
    });
  });

  // ---------------------------------------------------------------------------
  describe('completion rate bonus', () => {
    it('+20 for 100% completion rate', () => {
      const without = computeTrustScore(basePro());
      const with_ = computeTrustScore(basePro({
        completedMissionsCount: 10,
        cancelledMissionsCount: 0,
      }));
      expect(with_ - without).toBe(20);
    });

    it('+10 for 50% completion rate', () => {
      // Both pros have the same cancelled missions (same penalty) so the only
      // difference is the completion bonus from the 5 completed missions.
      const baseBonus = {
        user: { avatarUrl: 'http://img.jpg', emailVerified: true },
        verifiedByAdmin: true,  // +40 pts — large enough to stay out of zero-clamp
      };
      const without = computeTrustScore(basePro({
        ...baseBonus,
        completedMissionsCount: 0,
        cancelledMissionsCount: 5, // -25 penalty
      }));
      const with_ = computeTrustScore(basePro({
        ...baseBonus,
        completedMissionsCount: 5,
        cancelledMissionsCount: 5, // same -25 penalty + round(0.5*20)=+10 bonus
      }));
      expect(with_ - without).toBe(10);
    });

    it('+0 when total missions = 0', () => {
      const without = computeTrustScore(basePro());
      const with_ = computeTrustScore(basePro({
        completedMissionsCount: 0,
        cancelledMissionsCount: 0,
      }));
      expect(with_).toBe(without);
    });
  });

  // ---------------------------------------------------------------------------
  describe('seniority bonus', () => {
    it('+0 for a brand-new account', () => {
      const score = computeTrustScore(basePro({ createdAt: new Date() }));
      // All bonuses off except seniority ≈ 0
      expect(score).toBe(0);
    });

    it('+10 for 12+ months', () => {
      const without = computeTrustScore(basePro({ createdAt: new Date() }));
      const with_ = computeTrustScore(basePro({
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 400),
      }));
      expect(with_ - without).toBe(10);
    });

    it('seniority bonus is capped at 10 (more than 12 months)', () => {
      const twoYears = computeTrustScore(basePro({
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 730),
      }));
      const oneYear = computeTrustScore(basePro({
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 400),
      }));
      expect(twoYears).toBe(oneYear);
    });
  });

  // ---------------------------------------------------------------------------
  describe('penalties', () => {
    it('-10 per complaint', () => {
      const without = computeTrustScore(basePro({ complaintsCount: 0 }));
      const with1 = computeTrustScore(basePro({ complaintsCount: 1 }));
      const with2 = computeTrustScore(basePro({ complaintsCount: 2 }));
      // may clamp to 0 — test relative difference before clamping
      // We add a base bonus to avoid clamping:
      const base = basePro({
        user: { avatarUrl: 'x', emailVerified: true },
        verifiedByAdmin: true,
        complaintsCount: 0,
      });
      const base1 = { ...base, complaintsCount: 1 };
      expect(computeTrustScore(base) - computeTrustScore(base1)).toBe(10);
    });

    it('-5 per cancelled mission', () => {
      const base = basePro({
        user: { avatarUrl: 'x', emailVerified: true },
        verifiedByAdmin: true,
        cancelledMissionsCount: 0,
      });
      const base1 = { ...base, cancelledMissionsCount: 1 };
      expect(computeTrustScore(base) - computeTrustScore(base1)).toBe(5);
    });

    it('-8 per bad review', () => {
      const base = basePro({
        user: { avatarUrl: 'x', emailVerified: true },
        verifiedByAdmin: true,
      });
      const without = computeTrustScore(base, { badReviewCount: 0 });
      const with1 = computeTrustScore(base, { badReviewCount: 1 });
      expect(without - with1).toBe(8);
    });

    it('-15 for low average rating (< 2.5)', () => {
      const base = basePro({
        user: { avatarUrl: 'x', emailVerified: true },
        verifiedByAdmin: true,
        averageRating: 0,  // no penalty (== 0)
      });
      const low = { ...base, averageRating: 2.0 };
      expect(computeTrustScore(base) - computeTrustScore(low)).toBe(15);
    });

    it('no LOW_RATING penalty when averageRating == 0', () => {
      const without = computeTrustScore(basePro({ averageRating: 0 }));
      // Check there is no -15 applied by comparing with same pro at rating=3
      const three = computeTrustScore(basePro({ averageRating: 3 }));
      expect(without).toBe(three);
    });

    it('no LOW_RATING penalty when averageRating == 2.5 (boundary)', () => {
      const base = basePro({
        user: { avatarUrl: 'x', emailVerified: true },
        verifiedByAdmin: true,
        averageRating: 2.5,
      });
      const low = { ...base, averageRating: 2.49 };
      expect(computeTrustScore(base) - computeTrustScore(low)).toBe(15);
    });
  });

  // ---------------------------------------------------------------------------
  describe('company quality bonus', () => {
    it('+20 for ENTREPRISE with memberQualityRate >= 0.8', () => {
      const base = basePro({ accountType: 'ENTREPRISE' });
      const without = computeTrustScore(base, { memberQualityRate: 0.7 });
      const with_ = computeTrustScore(base, { memberQualityRate: 0.8 });
      expect(with_ - without).toBe(20);
    });

    it('no bonus for INDIVIDUEL with memberQualityRate >= 0.8', () => {
      const base = basePro({ accountType: 'INDIVIDUAL' });
      const without = computeTrustScore(base, { memberQualityRate: 0.7 });
      const with_ = computeTrustScore(base, { memberQualityRate: 0.9 });
      expect(with_).toBe(without);
    });

    it('no bonus for ENTREPRISE with undefined memberQualityRate', () => {
      const base = basePro({ accountType: 'ENTREPRISE' });
      const without = computeTrustScore(base, {});
      const with_ = computeTrustScore(base, { memberQualityRate: undefined });
      expect(with_).toBe(without);
    });
  });
});

// ---------------------------------------------------------------------------
describe('getTrustScoreBreakdown', () => {
  it('returns bonus, penalties, and total fields', () => {
    const result = getTrustScoreBreakdown(basePro());
    expect(result).toHaveProperty('bonus');
    expect(result).toHaveProperty('penalties');
    expect(result).toHaveProperty('total');
    expect(Array.isArray(result.bonus)).toBe(true);
    expect(Array.isArray(result.penalties)).toBe(true);
  });

  it('total matches computeTrustScore output', () => {
    const pro = basePro({
      user: { avatarUrl: 'http://img.jpg', emailVerified: true },
      verifiedByAdmin: true,
      portfolio: [1, 2, 3],
      description: 'A'.repeat(60),
    });
    const extras = { quoteSentCount: 2, goodReviewCount: 3 };
    const breakdown = getTrustScoreBreakdown(pro, extras);
    expect(breakdown.total).toBe(computeTrustScore(pro, extras));
  });

  it('bonus array contains entries for each active bonus', () => {
    const pro = basePro({
      user: { avatarUrl: 'http://img.jpg', emailVerified: false },
      verifiedByAdmin: false,
    });
    const result = getTrustScoreBreakdown(pro);
    const avatarEntry = result.bonus.find(b => b.label === 'Photo de profil');
    expect(avatarEntry).toBeDefined();
    expect(avatarEntry.points).toBe(10);
  });

  it('no bonus entry when avatar is null', () => {
    const result = getTrustScoreBreakdown(basePro({ user: { avatarUrl: null, emailVerified: false } }));
    const avatarEntry = result.bonus.find(b => b.label === 'Photo de profil');
    expect(avatarEntry).toBeUndefined();
  });

  it('penalty array contains entry for complaints', () => {
    const pro = basePro({
      user: { avatarUrl: 'x', emailVerified: true },
      verifiedByAdmin: true,
      complaintsCount: 2,
    });
    const result = getTrustScoreBreakdown(pro);
    const complaint = result.penalties.find(p => p.label.includes('Plaintes'));
    expect(complaint).toBeDefined();
    expect(complaint.points).toBe(-20);
  });

  it('penalty array contains LOW_RATING entry when averageRating < 2.5', () => {
    const pro = basePro({
      user: { avatarUrl: 'x', emailVerified: true },
      averageRating: 1.5,
    });
    const result = getTrustScoreBreakdown(pro);
    const lowRating = result.penalties.find(p => p.label === 'Note moyenne faible');
    expect(lowRating).toBeDefined();
  });

  it('no LOW_RATING entry when averageRating is 0', () => {
    const result = getTrustScoreBreakdown(basePro({ averageRating: 0 }));
    const lowRating = result.penalties.find(p => p.label === 'Note moyenne faible');
    expect(lowRating).toBeUndefined();
  });

  it('bonus array contains company quality entry when eligible', () => {
    const pro = basePro({ accountType: 'ENTREPRISE' });
    const result = getTrustScoreBreakdown(pro, { memberQualityRate: 0.85 });
    const company = result.bonus.find(b => b.label && b.label.includes('Équipe'));
    expect(company).toBeDefined();
    expect(company.points).toBe(20);
  });

  it('rating bonus entry shows correct goodReviewCount', () => {
    const pro = basePro();
    const result = getTrustScoreBreakdown(pro, { goodReviewCount: 3 });
    const rating = result.bonus.find(b => b.label && b.label.includes('Avis positifs'));
    expect(rating).toBeDefined();
    expect(rating.points).toBe(15); // 3 * 5
  });

  it('completion bonus appears when total missions > 0', () => {
    const pro = basePro({
      completedMissionsCount: 8,
      cancelledMissionsCount: 2,
    });
    const result = getTrustScoreBreakdown(pro);
    const completion = result.bonus.find(b => b.label && b.label.includes('Taux complétion'));
    expect(completion).toBeDefined();
    expect(completion.points).toBe(16); // round(0.8 * 20)
  });

  it('seniority bonus appears after 12 months', () => {
    const pro = basePro({
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 400),
    });
    const result = getTrustScoreBreakdown(pro);
    const seniority = result.bonus.find(b => b.label && b.label.includes('Ancienneté'));
    expect(seniority).toBeDefined();
    expect(seniority.points).toBe(10);
  });

  it('no cancelled missions penalty when count is 0', () => {
    const result = getTrustScoreBreakdown(basePro({ cancelledMissionsCount: 0 }));
    const cancel = result.penalties.find(p => p.label && p.label.includes('annulées'));
    expect(cancel).toBeUndefined();
  });

  it('bad review penalty entry shows correct points', () => {
    const pro = basePro({
      user: { avatarUrl: 'x', emailVerified: true },
      verifiedByAdmin: true,
    });
    const result = getTrustScoreBreakdown(pro, { badReviewCount: 3 });
    const bad = result.penalties.find(p => p.label && p.label.includes('négatifs'));
    expect(bad).toBeDefined();
    expect(bad.points).toBe(-24); // 3 * -8
  });
});

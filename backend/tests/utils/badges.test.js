'use strict';

/**
 * Tests pour utils/badges.js
 * Calcul et persistence des badges professionnels
 */

// Mock trustScore — module virtuel car pas encore créé
jest.mock('../../utils/trustScore', () => ({
  computeTrustScore: jest.fn().mockReturnValue(0),
}), { virtual: true });

// Mock Prisma
jest.mock('../../config/db', () => ({
  professional: {
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  professionalBadge: {
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
}));

const { BADGES, computeBadges } = require('../../utils/badges');
const prisma = require('../../config/db');
const { computeTrustScore } = require('../../utils/trustScore');

// Professionnel par défaut sans aucun critère satisfait
const baseProMock = () => ({
  id: 'pro-test',
  quotes: [],
  completedMissionsCount: 0,
  reviewCount: 0,
  averageRating: 0,
  identityStatus: 'PENDING',
  accountType: 'INDIVIDUAL',
  verifiedByAdmin: false,
  createdAt: new Date(),
  badges: [],
  subscription: null,
  portfolioProjects: [],
  reviews: [],
  user: {},
});

// Helper : extraire les badgeKeys ajoutés lors du dernier appel createMany
// Retourne [] si createMany n'a pas été appelé
function getAddedBadgeKeys() {
  const calls = prisma.professionalBadge.createMany.mock.calls;
  if (calls.length === 0) return [];
  return calls[0][0].data.map(b => b.badgeKey);
}

beforeEach(() => {
  jest.clearAllMocks();
  computeTrustScore.mockReturnValue(0);

  prisma.professional.count.mockResolvedValue(500);
  prisma.professionalBadge.createMany.mockResolvedValue({ count: 0 });
  prisma.professionalBadge.findMany.mockResolvedValue([]);
});

// ─── BADGES constant ─────────────────────────────────────────────────────────

describe('BADGES — constante', () => {
  it('exporte 13 badges définis', () => {
    expect(Object.keys(BADGES)).toHaveLength(13);
  });

  it('chaque badge a les propriétés obligatoires', () => {
    Object.values(BADGES).forEach(badge => {
      expect(badge).toHaveProperty('key');
      expect(badge).toHaveProperty('label');
      expect(badge).toHaveProperty('icon');
      expect(badge).toHaveProperty('color');
      expect(badge).toHaveProperty('description');
    });
  });

  it('les couleurs sont en format hex #RRGGBB', () => {
    Object.values(BADGES).forEach(badge => {
      expect(badge.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  it('FIRST_QUOTE a le bon label', () => {
    expect(BADGES.FIRST_QUOTE.label).toBe('Premier devis');
  });

  it('TOP_RATED a la bonne description', () => {
    expect(BADGES.TOP_RATED.description).toContain('4.5');
  });
});

// ─── computeBadges — pro inexistant ──────────────────────────────────────────

describe('computeBadges — pro inexistant', () => {
  it('retourne [] si findUnique retourne null', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const result = await computeBadges('nonexistent');

    expect(result).toEqual([]);
    expect(prisma.professionalBadge.createMany).not.toHaveBeenCalled();
  });
});

// ─── computeBadges — FIRST_QUOTE ─────────────────────────────────────────────

describe('computeBadges — FIRST_QUOTE', () => {
  it('attribue FIRST_QUOTE si quotes >= 1 et pas encore earned', async () => {
    const pro = { ...baseProMock(), quotes: [{ id: 'q1' }] };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('FIRST_QUOTE');
    expect(prisma.professionalBadge.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('ne ré-attribue pas FIRST_QUOTE si déjà earned', async () => {
    const pro = {
      ...baseProMock(),
      quotes: [{ id: 'q1' }],
      badges: [{ badgeKey: 'FIRST_QUOTE' }],
    };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('FIRST_QUOTE');
  });
});

// ─── computeBadges — FIRST_MISSION ───────────────────────────────────────────

describe('computeBadges — FIRST_MISSION', () => {
  it('attribue FIRST_MISSION si completedMissionsCount >= 1', async () => {
    const pro = { ...baseProMock(), completedMissionsCount: 1 };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('FIRST_MISSION');
  });

  it('n\'attribue pas FIRST_MISSION si completedMissionsCount = 0', async () => {
    prisma.professional.findUnique.mockResolvedValue(baseProMock());

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('FIRST_MISSION');
  });
});

// ─── computeBadges — TEN_MISSIONS / FIFTY_MISSIONS ───────────────────────────

describe('computeBadges — TEN_MISSIONS / FIFTY_MISSIONS', () => {
  it('attribue TEN_MISSIONS si completedMissionsCount >= 10', async () => {
    const pro = { ...baseProMock(), completedMissionsCount: 10 };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('TEN_MISSIONS');
  });

  it('attribue FIFTY_MISSIONS si completedMissionsCount >= 50', async () => {
    const pro = { ...baseProMock(), completedMissionsCount: 50 };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('FIFTY_MISSIONS');
  });

  it('n\'attribue pas TEN_MISSIONS pour 9 missions', async () => {
    const pro = { ...baseProMock(), completedMissionsCount: 9 };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('TEN_MISSIONS');
  });
});

// ─── computeBadges — TOP_RATED ────────────────────────────────────────────────

describe('computeBadges — TOP_RATED', () => {
  it('attribue TOP_RATED si reviewCount >= 10 ET averageRating >= 4.5', async () => {
    const pro = { ...baseProMock(), reviewCount: 10, averageRating: 4.5 };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('TOP_RATED');
  });

  it('n\'attribue pas TOP_RATED si reviewCount < 10', async () => {
    const pro = { ...baseProMock(), reviewCount: 9, averageRating: 5 };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('TOP_RATED');
  });

  it('n\'attribue pas TOP_RATED si averageRating < 4.5', async () => {
    const pro = { ...baseProMock(), reviewCount: 15, averageRating: 4.4 };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('TOP_RATED');
  });
});

// ─── computeBadges — VERIFIED_ID ─────────────────────────────────────────────

describe('computeBadges — VERIFIED_ID', () => {
  it('attribue VERIFIED_ID si identityStatus = APPROVED', async () => {
    const pro = { ...baseProMock(), identityStatus: 'APPROVED' };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('VERIFIED_ID');
  });

  it('n\'attribue pas VERIFIED_ID si identityStatus = PENDING', async () => {
    prisma.professional.findUnique.mockResolvedValue(baseProMock());

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('VERIFIED_ID');
  });
});

// ─── computeBadges — PREMIUM ──────────────────────────────────────────────────

describe('computeBadges — PREMIUM', () => {
  it('attribue PREMIUM si subscription.status = ACTIVE', async () => {
    const pro = { ...baseProMock(), subscription: { status: 'ACTIVE' } };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('PREMIUM');
  });

  it('n\'attribue pas PREMIUM si subscription = null', async () => {
    prisma.professional.findUnique.mockResolvedValue(baseProMock());

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('PREMIUM');
  });

  it('n\'attribue pas PREMIUM si subscription.status = INACTIVE', async () => {
    const pro = { ...baseProMock(), subscription: { status: 'INACTIVE' } };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('PREMIUM');
  });
});

// ─── computeBadges — PORTFOLIO_RICH ──────────────────────────────────────────

describe('computeBadges — PORTFOLIO_RICH', () => {
  it('attribue PORTFOLIO_RICH si portfolioProjects.length >= 10', async () => {
    const pro = { ...baseProMock(), portfolioProjects: Array(10).fill({}) };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('PORTFOLIO_RICH');
  });

  it('n\'attribue pas PORTFOLIO_RICH pour 9 projets', async () => {
    const pro = { ...baseProMock(), portfolioProjects: Array(9).fill({}) };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('PORTFOLIO_RICH');
  });
});

// ─── computeBadges — TRUSTED ──────────────────────────────────────────────────

describe('computeBadges — TRUSTED', () => {
  it('attribue TRUSTED si trustScore >= 80', async () => {
    computeTrustScore.mockReturnValue(80);
    prisma.professional.findUnique.mockResolvedValue(baseProMock());

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('TRUSTED');
  });

  it('n\'attribue pas TRUSTED si trustScore = 79', async () => {
    computeTrustScore.mockReturnValue(79);
    prisma.professional.findUnique.mockResolvedValue(baseProMock());

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('TRUSTED');
  });
});

// ─── computeBadges — COMPANY ──────────────────────────────────────────────────

describe('computeBadges — COMPANY', () => {
  it('attribue COMPANY si accountType=ENTREPRISE ET verifiedByAdmin=true', async () => {
    const pro = { ...baseProMock(), accountType: 'ENTREPRISE', verifiedByAdmin: true };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('COMPANY');
  });

  it('n\'attribue pas COMPANY si verifiedByAdmin=false', async () => {
    const pro = { ...baseProMock(), accountType: 'ENTREPRISE', verifiedByAdmin: false };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('COMPANY');
  });
});

// ─── computeBadges — EARLY_ADOPTER ───────────────────────────────────────────

describe('computeBadges — EARLY_ADOPTER', () => {
  it('attribue EARLY_ADOPTER si rank < 500', async () => {
    prisma.professional.count.mockResolvedValue(100); // rang = 100
    prisma.professional.findUnique.mockResolvedValue(baseProMock());

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).toContain('EARLY_ADOPTER');
  });

  it('n\'attribue pas EARLY_ADOPTER si rank >= 500', async () => {
    prisma.professional.count.mockResolvedValue(500); // rang = 500
    prisma.professional.findUnique.mockResolvedValue(baseProMock());

    await computeBadges('pro-test');

    expect(getAddedBadgeKeys()).not.toContain('EARLY_ADOPTER');
  });
});

// ─── computeBadges — retour avec métadonnées ──────────────────────────────────

describe('computeBadges — retour avec métadonnées', () => {
  it('retourne les badges enrichis avec BADGES metadata', async () => {
    prisma.professional.findUnique.mockResolvedValue(baseProMock());
    prisma.professionalBadge.findMany.mockResolvedValue([
      { badgeKey: 'VERIFIED_ID', earnedAt: new Date() },
    ]);

    const result = await computeBadges('pro-test');

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('label', 'Identité vérifiée');
    expect(result[0]).toHaveProperty('icon');
    expect(result[0]).toHaveProperty('color');
  });

  it('filtre les badgeKey inconnus (sans label)', async () => {
    prisma.professional.findUnique.mockResolvedValue(baseProMock());
    prisma.professionalBadge.findMany.mockResolvedValue([
      { badgeKey: 'UNKNOWN_BADGE', earnedAt: new Date() },
      { badgeKey: 'FIRST_QUOTE', earnedAt: new Date() },
    ]);

    const result = await computeBadges('pro-test');

    expect(result.every(b => b.label !== undefined)).toBe(true);
    expect(result.some(b => b.badgeKey === 'FIRST_QUOTE')).toBe(true);
  });

  it('utilise skipDuplicates lors du createMany', async () => {
    const pro = { ...baseProMock(), quotes: [{ id: 'q1' }] };
    prisma.professional.findUnique.mockResolvedValue(pro);

    await computeBadges('pro-test');

    const createCall = prisma.professionalBadge.createMany.mock.calls[0][0];
    expect(createCall.skipDuplicates).toBe(true);
  });

  it('trie les badges par earnedAt (orderBy asc)', async () => {
    prisma.professional.findUnique.mockResolvedValue(baseProMock());

    await computeBadges('pro-test');

    expect(prisma.professionalBadge.findMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro-test' },
      orderBy: { earnedAt: 'asc' },
    });
  });

  it('ne call pas createMany si toAdd est vide', async () => {
    // Aucun critère satisfait avec baseProMock() + count=500 (pas d'early adopter)
    prisma.professional.findUnique.mockResolvedValue(baseProMock());
    prisma.professional.count.mockResolvedValue(500);

    await computeBadges('pro-test');

    expect(prisma.professionalBadge.createMany).not.toHaveBeenCalled();
  });
});

// ─── computeBadges — concurrence (locking) ───────────────────────────────────

describe('computeBadges — concurrence (locking)', () => {
  it('exécute deux appels simultanés sans crash', async () => {
    prisma.professional.findUnique.mockResolvedValue(baseProMock());
    prisma.professionalBadge.createMany.mockResolvedValue({ count: 0 });
    prisma.professionalBadge.findMany.mockResolvedValue([]);

    const [r1, r2] = await Promise.all([
      computeBadges('pro-lock'),
      computeBadges('pro-lock'),
    ]);

    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true);
  });
});

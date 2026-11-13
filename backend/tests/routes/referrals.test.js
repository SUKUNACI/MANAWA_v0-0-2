const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

// ============ MOCKS ============

jest.mock('../../config/db', () => ({
  appConfig: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    upsert: jest.fn(),
  },
  referral: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  user: { findUnique: jest.fn() },
}));

jest.mock('../../config/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const jwt = require('jsonwebtoken');
    try {
      req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: 'Token invalide' });
    }
  },
  requireRole: (role) => (req, res, next) => {
    const roles = Array.isArray(role) ? role : [role];
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  },
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue([]),
}));

const prisma = require('../../config/db');
const referralRoutes = require('../../routes/referrals');

const app = express();
app.use(express.json());
app.use('/api/referrals', referralRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ Fixtures ============

const PRO_ID = 'pro-user-1';
const REFERRER_ID = 'referrer-user-1';
const REF_CODE = 'REF-ABC123';

const mockConfig = { key: `referral_code_${PRO_ID}`, value: REF_CODE };

const mockReferrals = [
  { status: 'QUALIFIED' },
  { status: 'REWARDED' },
  { status: 'PENDING' },
];

const mockReferralRecords = [
  {
    id: 'ref-1',
    status: 'PENDING',
    code: REF_CODE,
    createdAt: new Date().toISOString(),
    qualifiedAt: null,
    rewardedAt: null,
    rewardType: null,
    rewardValue: null,
    referred: {
      id: 'referred-1',
      firstName: 'Alice',
      lastName: 'Martin',
      avatarUrl: null,
      createdAt: new Date().toISOString(),
    },
  },
];

// ============ GET /api/referrals/my-code ============

describe('GET /api/referrals/my-code', () => {
  beforeEach(() => {
    prisma.appConfig.findUnique.mockResolvedValue(mockConfig);
    prisma.referral.findMany.mockResolvedValue(mockReferrals);
  });

  test('200 — retourne le code existant avec statistiques', async () => {
    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('code', REF_CODE);
    expect(res.body).toHaveProperty('total', 3);
    expect(res.body).toHaveProperty('qualified', 2);
    expect(res.body).toHaveProperty('rewarded', 1);
  });

  test('200 — génère un nouveau code si aucun n\'existe', async () => {
    prisma.appConfig.findUnique.mockResolvedValue(null);
    prisma.appConfig.findFirst.mockResolvedValue(null);
    prisma.appConfig.upsert.mockResolvedValue({ key: `referral_code_${PRO_ID}`, value: 'REF-NEW123' });
    prisma.referral.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('code');
    expect(prisma.appConfig.upsert).toHaveBeenCalled();
  });

  test('200 — total/qualified/rewarded à 0 si aucun filleul', async () => {
    prisma.referral.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.qualified).toBe(0);
    expect(res.body.rewarded).toBe(0);
  });

  test('401 — sans token', async () => {
    const res = await request(app).get('/api/referrals/my-code');
    expect(res.status).toBe(401);
  });

  test('403 — un client ne peut pas accéder à son code', async () => {
    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(403);
  });

  test('403 — un admin ne peut pas accéder à son code', async () => {
    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(403);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.appConfig.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST /api/referrals/use ============

describe('POST /api/referrals/use', () => {
  beforeEach(() => {
    prisma.referral.findUnique.mockResolvedValue(null);
    prisma.appConfig.findMany.mockResolvedValue([
      { key: `referral_code_${REFERRER_ID}`, value: REF_CODE },
    ]);
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === REFERRER_ID) {
        return Promise.resolve({ id: REFERRER_ID, firstName: 'Jean', lastName: 'Dupont' });
      }
      return Promise.resolve({ id: PRO_ID, firstName: 'Alice', lastName: 'Martin' });
    });
    prisma.referral.create.mockResolvedValue({
      id: 'ref-new',
      referrerId: REFERRER_ID,
      referredId: PRO_ID,
      code: REF_CODE,
      status: 'PENDING',
    });
  });

  test('200 — utilise le code avec succès', async () => {
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: REF_CODE });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('referrerName');
    expect(prisma.referral.create).toHaveBeenCalled();
  });

  test('envoie une notification push au parrain', async () => {
    const { sendPushNotification } = require('../../config/pushNotifications');

    await request(app)
      .post('/api/referrals/use')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: REF_CODE });

    expect(sendPushNotification).toHaveBeenCalled();
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/referrals/use')
      .send({ code: REF_CODE });

    expect(res.status).toBe(401);
  });

  test('403 — un client ne peut pas utiliser un code', async () => {
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ code: REF_CODE });

    expect(res.status).toBe(403);
  });

  test('400 — code manquant (validation)', async () => {
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('400 — code trop court (moins de 5 chars)', async () => {
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'AB' });

    expect(res.status).toBe(400);
  });

  test('409 — pro déjà parrainé', async () => {
    prisma.referral.findUnique.mockResolvedValue({
      id: 'existing-ref',
      referrerId: REFERRER_ID,
      referredId: PRO_ID,
    });

    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: REF_CODE });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/déjà été parrainé/i);
  });

  test('404 — code de parrainage invalide (aucun résultat)', async () => {
    prisma.appConfig.findMany.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: 'REF-XXXXXX' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('400 — un pro ne peut pas utiliser son propre code', async () => {
    // Le code REF_CODE appartient à PRO_ID (pas à REFERRER_ID)
    prisma.appConfig.findMany.mockResolvedValue([
      { key: `referral_code_${PRO_ID}`, value: REF_CODE },
    ]);

    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: REF_CODE });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/votre propre code/i);
  });

  test('404 — parrain introuvable en base (user supprimé)', async () => {
    prisma.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === REFERRER_ID) return Promise.resolve(null);
      return Promise.resolve({ id: PRO_ID, firstName: 'Alice', lastName: 'Martin' });
    });

    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: REF_CODE });

    expect(res.status).toBe(404);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.referral.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`)
      .send({ code: REF_CODE });

    expect(res.status).toBe(500);
  });
});

// ============ GET /api/referrals/mine ============

describe('GET /api/referrals/mine', () => {
  beforeEach(() => {
    prisma.referral.findMany.mockResolvedValue(mockReferralRecords);
  });

  test('200 — retourne la liste des filleuls', async () => {
    const res = await request(app)
      .get('/api/referrals/mine')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('status', 'PENDING');
    expect(res.body[0]).toHaveProperty('referred');
    expect(prisma.referral.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { referrerId: PRO_ID } })
    );
  });

  test('200 — liste vide si aucun filleul', async () => {
    prisma.referral.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/referrals/mine')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('401 — sans token', async () => {
    const res = await request(app).get('/api/referrals/mine');
    expect(res.status).toBe(401);
  });

  test('403 — un client ne peut pas lister ses filleuls', async () => {
    const res = await request(app)
      .get('/api/referrals/mine')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(403);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.referral.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/referrals/mine')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ GET /api/referrals/my-referrer ============

describe('GET /api/referrals/my-referrer', () => {
  test('200 — retourne le parrain si existant', async () => {
    prisma.referral.findUnique.mockResolvedValue({
      referrer: { id: REFERRER_ID, firstName: 'Jean', lastName: 'Dupont', avatarUrl: null },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get('/api/referrals/my-referrer')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('referrer');
    expect(res.body.referrer).toHaveProperty('id', REFERRER_ID);
    expect(res.body).toHaveProperty('status', 'PENDING');
  });

  test('200 — retourne referrer null si pas de parrain', async () => {
    prisma.referral.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/referrals/my-referrer')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ referrer: null });
  });

  test('401 — sans token', async () => {
    const res = await request(app).get('/api/referrals/my-referrer');
    expect(res.status).toBe(401);
  });

  test('403 — un client ne peut pas accéder à my-referrer', async () => {
    const res = await request(app)
      .get('/api/referrals/my-referrer')
      .set('Authorization', `Bearer ${clientToken()}`);

    expect(res.status).toBe(403);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.referral.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/referrals/my-referrer')
      .set('Authorization', `Bearer ${proToken(PRO_ID)}`);

    expect(res.status).toBe(500);
  });
});

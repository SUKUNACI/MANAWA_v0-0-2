const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

jest.mock('../../config/db', () => ({
  appConfig: { findFirst: jest.fn() },
  referral: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn() },
}));

jest.mock('../../config/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Non authentifie' });
    const jwt = require('jsonwebtoken');
    try { req.user = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET); next(); }
    catch { return res.status(401).json({ error: 'Token invalide' }); }
  },
  requireRole: (role) => (req, res, next) => {
    const roles = Array.isArray(role) ? role : [role];
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Acces refuse' });
    next();
  },
}));

const prisma = require('../../config/db');
const referralRoutes = require('../../routes/referrals');
const app = express();
app.use(express.json());
app.use('/api/referrals', referralRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const PRO_ID = 'pro-user-1';
const REFERRER_ID = 'referrer-user-1';
const REF_CODE = 'REF-ABC123';

const mockReferralRecords = [{
  id: 'ref-1',
  status: 'PENDING',
  code: REF_CODE,
  createdAt: new Date().toISOString(),
  referred: { id: 'referred-1', firstName: 'Alice', lastName: 'Martin', email: 'alice@test.com' },
}];

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /api/referrals/my-code', () => {
  beforeEach(() => {
    prisma.referral.findFirst.mockResolvedValue({ code: REF_CODE, referrerId: PRO_ID });
    prisma.referral.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValue(3);
  });

  test('200 retourne le code existant avec statistiques', async () => {
    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('code', REF_CODE);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('qualified');
    expect(res.body).toHaveProperty('rewarded');
  });

  test('200 genere un nouveau code si aucun nexiste', async () => {
    prisma.referral.findFirst.mockResolvedValue(null);
    prisma.referral.create.mockResolvedValue({ code: 'REF-NEW123', referrerId: PRO_ID });
    prisma.referral.count.mockResolvedValue(0);
    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('code');
    expect(prisma.referral.create).toHaveBeenCalled();
  });

  test('200 total qualified rewarded a 0 si aucun filleul', async () => {
    prisma.referral.findFirst.mockResolvedValue({ code: REF_CODE });
    prisma.referral.count.mockReset();
    prisma.referral.count.mockResolvedValue(0);
    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID));
    expect(res.status).toBe(200);
    expect(res.body.qualified).toBe(0);
    expect(res.body.rewarded).toBe(0);
  });

  test('401 sans token', async () => {
    const res = await request(app).get('/api/referrals/my-code');
    expect(res.status).toBe(401);
  });

  test('403 un client ne peut pas acceder a son code', async () => {
    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', 'Bearer ' + clientToken());
    expect(res.status).toBe(403);
  });

  test('403 un admin ne peut pas acceder a son code', async () => {
    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', 'Bearer ' + adminToken());
    expect(res.status).toBe(403);
  });

  test('500 erreur base de donnees propagee', async () => {
    prisma.referral.findFirst.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/referrals/my-code')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/referrals/use', () => {
  beforeEach(() => {
    prisma.referral.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue(null);
    prisma.appConfig.findFirst.mockResolvedValue({ key: 'referral_code_' + REF_CODE, value: REFERRER_ID });
    prisma.referral.create.mockResolvedValue({
      id: 'ref-new', referrerId: REFERRER_ID, referredId: PRO_ID, code: REF_CODE, status: 'PENDING',
    });
  });

  test('200 utilise le code avec succes', async () => {
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID))
      .send({ code: REF_CODE });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('referrerName');
    expect(prisma.referral.create).toHaveBeenCalled();
  });

  test('envoie une notification push au parrain', async () => {
    const { sendPushNotification } = require('../../config/pushNotifications');
    await request(app)
      .post('/api/referrals/use')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID))
      .send({ code: REF_CODE });
    await new Promise(r => setImmediate(r));
    expect(sendPushNotification).toHaveBeenCalled();
  });

  test('401 sans token', async () => {
    const res = await request(app)
      .post('/api/referrals/use')
      .send({ code: REF_CODE });
    expect(res.status).toBe(401);
  });

  test('403 un client ne peut pas utiliser un code', async () => {
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', 'Bearer ' + clientToken())
      .send({ code: REF_CODE });
    expect(res.status).toBe(403);
  });

  test('400 code manquant validation', async () => {
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID))
      .send({});
    expect(res.status).toBe(400);
  });

  test('400 code trop court moins de 5 chars', async () => {
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID))
      .send({ code: 'AB' });
    expect(res.status).toBe(400);
  });

  test('400 pro deja parraine', async () => {
    prisma.appConfig.findFirst.mockResolvedValue({ key: 'k', value: REFERRER_ID });
    prisma.referral.findFirst.mockReset();
    prisma.referral.findFirst.mockResolvedValue({ id: 'existing-ref' });
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID))
      .send({ code: REF_CODE });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parrainé|parraine/i);
  });

  test('400 code de parrainage invalide', async () => {
    prisma.appConfig.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID))
      .send({ code: 'REF-XXXXXX' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('400 un pro ne peut pas utiliser son propre code', async () => {
    prisma.appConfig.findFirst.mockResolvedValue({ key: 'referral_code_' + REF_CODE, value: PRO_ID });
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID))
      .send({ code: REF_CODE });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/votre propre code/i);
  });

  test('500 erreur base de donnees propagee', async () => {
    prisma.referral.findFirst.mockReset();
    prisma.referral.findFirst.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .post('/api/referrals/use')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID))
      .send({ code: REF_CODE });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/referrals/mine', () => {
  beforeEach(() => {
    prisma.referral.findMany.mockResolvedValue(mockReferralRecords);
  });

  test('200 retourne la liste des filleuls', async () => {
    const res = await request(app)
      .get('/api/referrals/mine')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('status', 'PENDING');
    expect(res.body[0]).toHaveProperty('referred');
    expect(prisma.referral.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { referrerId: PRO_ID } })
    );
  });

  test('200 liste vide si aucun filleul', async () => {
    prisma.referral.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/referrals/mine')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('401 sans token', async () => {
    const res = await request(app).get('/api/referrals/mine');
    expect(res.status).toBe(401);
  });

  test('403 un client ne peut pas lister ses filleuls', async () => {
    const res = await request(app)
      .get('/api/referrals/mine')
      .set('Authorization', 'Bearer ' + clientToken());
    expect(res.status).toBe(403);
  });

  test('500 erreur base de donnees propagee', async () => {
    prisma.referral.findMany.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/referrals/mine')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/referrals/my-referrer', () => {
  beforeEach(() => {
    prisma.referral.findFirst.mockResolvedValue(null);
  });

  test('200 retourne le parrain si existant', async () => {
    prisma.referral.findFirst.mockResolvedValue({
      referrer: { id: REFERRER_ID, firstName: 'Jean', lastName: 'Dupont' },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });
    const res = await request(app)
      .get('/api/referrals/my-referrer')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('referrer');
    expect(res.body.referrer).toHaveProperty('id', REFERRER_ID);
    expect(res.body).toHaveProperty('status', 'PENDING');
  });

  test('200 retourne referrer null si pas de parrain', async () => {
    prisma.referral.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/referrals/my-referrer')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ referrer: null });
  });

  test('401 sans token', async () => {
    const res = await request(app).get('/api/referrals/my-referrer');
    expect(res.status).toBe(401);
  });

  test('403 un client ne peut pas acceder a my-referrer', async () => {
    const res = await request(app)
      .get('/api/referrals/my-referrer')
      .set('Authorization', 'Bearer ' + clientToken());
    expect(res.status).toBe(403);
  });

  test('500 erreur base de donnees propagee', async () => {
    prisma.referral.findFirst.mockReset();
    prisma.referral.findFirst.mockRejectedValue(new Error('DB error'));
    const res = await request(app)
      .get('/api/referrals/my-referrer')
      .set('Authorization', 'Bearer ' + proToken(PRO_ID));
    expect(res.status).toBe(500);
  });
});

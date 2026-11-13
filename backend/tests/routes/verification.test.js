const request = require('supertest');
const express = require('express');
const { clientToken, proToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../../config/mailer', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue({ sent: false, devCode: '123456' }),
}));

jest.mock('../../config/sms', () => ({
  sendVerificationSms: jest.fn().mockResolvedValue({ sent: false }),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn().mockReturnValue({ skip: 0, take: 20 }),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn().mockReturnValue(['id', 'createdAt']),
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

// bcryptjs nécessite un vrai mock pour les comparaisons
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2b$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(false),
}));

const prisma = require('../../config/db');
const { sendVerificationEmail } = require('../../config/mailer');
const { sendVerificationSms } = require('../../config/sms');
const bcrypt = require('bcryptjs');
const verificationRouter = require('../../routes/verification');

const app = express();
app.use(express.json());
app.use('/api/verification', verificationRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ FIXTURES ============

const USER_ID = 'user-verif-1';
const USER_EMAIL = 'user@test.com';

const mockUser = {
  id: USER_ID,
  email: USER_EMAIL,
  emailVerified: false,
  phoneVerified: false,
  phone: null,
  emailVerifyCode: '123456',
  emailVerifyExpiry: new Date(Date.now() + 15 * 60 * 1000),
  phoneOtpCode: '654321',
  phoneOtpExpiry: new Date(Date.now() + 15 * 60 * 1000),
  passwordResetCode: '999888',
  passwordResetExpiry: new Date(Date.now() + 15 * 60 * 1000),
  passwordHash: '$2b$10$oldhash',
};

// ============ POST /email/send ============

describe('POST /api/verification/email/send', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).post('/api/verification/email/send');
    expect(res.status).toBe(401);
  });

  test('200 — envoie un code de vérification par email', async () => {
    prisma.user.update.mockResolvedValue({ ...mockUser, email: USER_EMAIL });

    const res = await request(app)
      .post('/api/verification/email/send')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/envoy/i);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({
          emailVerifyCode: expect.any(String),
          emailVerifyExpiry: expect.any(Date),
        }),
      })
    );
    expect(sendVerificationEmail).toHaveBeenCalled();
  });

  test('500 — erreur DB lors du update', async () => {
    prisma.user.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/verification/email/send')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST /email/confirm ============

describe('POST /api/verification/email/confirm', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .post('/api/verification/email/confirm')
      .send({ code: '123456' });
    expect(res.status).toBe(401);
  });

  test('400 — code manquant', async () => {
    const res = await request(app)
      .post('/api/verification/email/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('400 — code trop court (< 6 chiffres)', async () => {
    const res = await request(app)
      .post('/api/verification/email/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ code: '12345' });
    expect(res.status).toBe(400);
  });

  test('400 — code non numérique', async () => {
    const res = await request(app)
      .post('/api/verification/email/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ code: 'abcdef' });
    expect(res.status).toBe(400);
  });

  test('400 — code incorrect', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockUser, emailVerifyCode: '999999' });

    const res = await request(app)
      .post('/api/verification/email/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ code: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('400 — code expiré', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      emailVerifyCode: '123456',
      emailVerifyExpiry: new Date(Date.now() - 1000), // expiré
    });

    const res = await request(app)
      .post('/api/verification/email/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ code: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expir/i);
  });

  test('200 — code correct et non expiré → email vérifié', async () => {
    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.update.mockResolvedValue({ ...mockUser, emailVerified: true });

    const res = await request(app)
      .post('/api/verification/email/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ code: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailVerified: true,
          emailVerifyCode: null,
          emailVerifyExpiry: null,
        }),
      })
    );
  });

  test('500 — erreur DB lors du findUnique', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/verification/email/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ code: '123456' });

    expect(res.status).toBe(500);
  });
});

// ============ POST /phone/send ============

describe('POST /api/verification/phone/send', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .post('/api/verification/phone/send')
      .send({ phone: '+33612345678' });
    expect(res.status).toBe(401);
  });

  test('400 — numéro de téléphone absent', async () => {
    const res = await request(app)
      .post('/api/verification/phone/send')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requis/i);
  });

  test('200 — envoie un code OTP par SMS', async () => {
    prisma.user.update.mockResolvedValue({ ...mockUser, phone: '+33612345678' });

    const res = await request(app)
      .post('/api/verification/phone/send')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ phone: '+33612345678' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/envoy/i);
    expect(sendVerificationSms).toHaveBeenCalledWith('+33612345678', expect.any(String));
  });

  test('500 — erreur DB lors du update', async () => {
    prisma.user.update.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/verification/phone/send')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ phone: '+33612345678' });

    expect(res.status).toBe(500);
  });
});

// ============ POST /phone/confirm ============

describe('POST /api/verification/phone/confirm', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .post('/api/verification/phone/confirm')
      .send({ code: '654321' });
    expect(res.status).toBe(401);
  });

  test('400 — code OTP incorrect', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockUser, phoneOtpCode: '111111' });

    const res = await request(app)
      .post('/api/verification/phone/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ code: '654321' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('400 — code OTP expiré', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      phoneOtpCode: '654321',
      phoneOtpExpiry: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .post('/api/verification/phone/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ code: '654321' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expir/i);
  });

  test('200 — code OTP correct → téléphone vérifié', async () => {
    prisma.user.findUnique.mockResolvedValue(mockUser);
    prisma.user.update.mockResolvedValue({ ...mockUser, phoneVerified: true });

    const res = await request(app)
      .post('/api/verification/phone/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ code: '654321' });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phoneVerified: true, phoneOtpCode: null }),
      })
    );
  });

  test('500 — erreur DB', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/verification/phone/confirm')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`)
      .send({ code: '654321' });

    expect(res.status).toBe(500);
  });
});

// ============ POST /password/request-reset ============

describe('POST /api/verification/password/request-reset', () => {
  test('200 — retourne un message générique même si l\'email n\'existe pas', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/verification/password/request-reset')
      .send({ email: 'inconnu@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/si ce compte existe/i);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  test('400 — email non vérifié', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockUser, emailVerified: false });

    const res = await request(app)
      .post('/api/verification/password/request-reset')
      .send({ email: USER_EMAIL });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/v.rifi/i);
  });

  test('200 — email vérifié → envoie le code reset', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockUser, emailVerified: true });
    prisma.user.update.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/verification/password/request-reset')
      .send({ email: USER_EMAIL });

    expect(res.status).toBe(200);
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      USER_EMAIL,
      expect.any(String),
      'reset'
    );
  });

  test('500 — erreur DB', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/verification/password/request-reset')
      .send({ email: USER_EMAIL });

    expect(res.status).toBe(500);
  });
});

// ============ POST /password/reset ============

describe('POST /api/verification/password/reset', () => {
  test('400 — nouveau mot de passe trop court (< 8 chars)', async () => {
    const res = await request(app)
      .post('/api/verification/password/reset')
      .send({ email: USER_EMAIL, code: '999888', newPassword: '1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 caract/i);
  });

  test('400 — code incorrect ou user non trouvé', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...mockUser, passwordResetCode: 'different' });

    const res = await request(app)
      .post('/api/verification/password/reset')
      .send({ email: USER_EMAIL, code: '999888', newPassword: 'newpassword123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('400 — code expiré', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      passwordResetExpiry: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .post('/api/verification/password/reset')
      .send({ email: USER_EMAIL, code: '999888', newPassword: 'newpassword123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expir/i);
  });

  test('400 — même mot de passe que l\'ancien', async () => {
    prisma.user.findUnique.mockResolvedValue(mockUser);
    bcrypt.compare.mockResolvedValueOnce(true); // même mot de passe

    const res = await request(app)
      .post('/api/verification/password/reset')
      .send({ email: USER_EMAIL, code: '999888', newPassword: 'samepassword1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/diff.rent/i);
  });

  test('200 — réinitialise le mot de passe avec succès', async () => {
    prisma.user.findUnique.mockResolvedValue(mockUser);
    bcrypt.compare.mockResolvedValueOnce(false);
    bcrypt.hash.mockResolvedValueOnce('$2b$10$newhash');
    prisma.user.update.mockResolvedValue({ ...mockUser, passwordHash: '$2b$10$newhash' });

    const res = await request(app)
      .post('/api/verification/password/reset')
      .send({ email: USER_EMAIL, code: '999888', newPassword: 'NewPass123!' });

    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          passwordHash: '$2b$10$newhash',
          passwordResetCode: null,
          passwordResetExpiry: null,
        }),
      })
    );
  });

  test('500 — erreur DB lors du findUnique', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/verification/password/reset')
      .send({ email: USER_EMAIL, code: '999888', newPassword: 'newpassword123' });

    expect(res.status).toBe(500);
  });
});

// ============ GET /status ============

describe('GET /api/verification/status', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/verification/status');
    expect(res.status).toBe(401);
  });

  test('200 — retourne le statut de vérification', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      emailVerified: true,
      phoneVerified: false,
      phone: '+33612345678',
    });

    const res = await request(app)
      .get('/api/verification/status')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('emailVerified', true);
    expect(res.body).toHaveProperty('phoneVerified', false);
    expect(res.body).toHaveProperty('phone', '+33612345678');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: USER_ID } });
  });

  test('200 — email et téléphone non vérifiés (compte tout neuf)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      emailVerified: false,
      phoneVerified: false,
      phone: null,
    });

    const res = await request(app)
      .get('/api/verification/status')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.emailVerified).toBe(false);
    expect(res.body.phoneVerified).toBe(false);
    expect(res.body.phone).toBeNull();
  });

  test('500 — erreur DB', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/verification/status')
      .set('Authorization', `Bearer ${clientToken(USER_ID)}`);

    expect(res.status).toBe(500);
  });
});

const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../config/db', () => ({
  quote: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  professional: {
    findUnique: jest.fn(),
  },
  project: {
    update: jest.fn(),
  },
}));

jest.mock('../../config/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../utils/generateQuotePdf', () => {
  const mockFn = jest.fn().mockResolvedValue('https://cloudinary.com/test/devis.pdf');
  mockFn.generateQuotePdfBuffer = jest.fn().mockResolvedValue(Buffer.from('fake-pdf-content'));
  return mockFn;
});

jest.mock('../../utils/badges', () => ({
  computeBadges: jest.fn().mockResolvedValue(true),
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
  getSortableFields: jest.fn().mockReturnValue(['id', 'createdAt', 'status']),
}));

jest.mock('../../routes/subscriptions', () => ({
  getActiveTier: jest.fn().mockReturnValue('GRATUIT'),
  getTierConfig: jest.fn().mockReturnValue({
    label: 'Gratuit',
    maxQuotesPerMonth: 5,
  }),
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

const prisma = require('../../config/db');
const { sendPushNotification } = require('../../config/pushNotifications');
const generateQuotePdf = require('../../utils/generateQuotePdf');
const { getActiveTier, getTierConfig } = require('../../routes/subscriptions');
const quotesRouter = require('../../routes/quotes');

const app = express();
app.use(express.json());
app.use('/api/quotes', quotesRouter);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// ============ TEST DATA FIXTURES ============

const CLIENT_USER_ID = 'client-1';
const PRO_USER_ID = 'pro-user-1';
const PRO_ID = 'pro-1';
const ADMIN_USER_ID = 'admin-1';
const PROJECT_ID = 'project-1';
const QUOTE_ID = 'quote-1';

const mockProUser = {
  id: PRO_USER_ID,
  role: 'PROFESSIONAL',
  email: 'pro@test.com',
  firstName: 'Marie',
  lastName: 'Martin',
  phone: '+261123456789',
  city: 'Antananarivo',
};

const mockClientUser = {
  id: CLIENT_USER_ID,
  role: 'CLIENT',
  email: 'client@test.com',
  firstName: 'Jean',
  lastName: 'Dupont',
  phone: '+261987654321',
  city: 'Antananarivo',
};

const mockProfessional = {
  id: PRO_ID,
  userId: PRO_USER_ID,
  trade: 'Plombier',
  verifiedByAdmin: true,
  subscription: null,
  trialEndsAt: null,
  user: mockProUser,
};

const mockProject = {
  id: PROJECT_ID,
  title: 'Réparation plomberie urgente',
  clientId: CLIENT_USER_ID,
  status: 'OPEN',
  tradeNeeded: 'Plombier',
  city: 'Antananarivo',
  client: mockClientUser,
};

const mockQuote = {
  id: QUOTE_ID,
  projectId: PROJECT_ID,
  professionalId: PRO_ID,
  mode: 'SIMPLE',
  amount: 150000,
  description: 'Remplacement joint et robinet',
  status: 'PENDING',
  version: 1,
  validityDays: 15,
  pdfUrl: 'https://cloudinary.com/test/devis.pdf',
  expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [],
  parentQuoteId: null,
  professional: {
    ...mockProfessional,
    user: mockProUser,
  },
  project: mockProject,
  revisions: [],
};

const mockDetailedQuote = {
  ...mockQuote,
  id: 'quote-detailed-1',
  mode: 'DETAILED',
  amount: 200000,
  items: [
    { id: 'item-1', category: 'LABOUR', label: 'Main d\'oeuvre', quantity: 2, unit: 'h', unitPrice: 50000, total: 100000, sortOrder: 0 },
    { id: 'item-2', category: 'MATERIALS', label: 'Robinet', quantity: 2, unit: 'pcs', unitPrice: 50000, total: 100000, sortOrder: 1 },
  ],
};

// ============ HELPERS ============

function setupProMock(verified = true) {
  prisma.professional.findUnique.mockResolvedValue({
    ...mockProfessional,
    verifiedByAdmin: verified,
  });
}

function setupQuoteMock(quote = mockQuote) {
  prisma.quote.findUnique.mockResolvedValue(quote);
}

beforeEach(() => {
  jest.clearAllMocks();
  getTierConfig.mockReturnValue({ label: 'Gratuit', maxQuotesPerMonth: 5 });
  getActiveTier.mockReturnValue('GRATUIT');
});

// ============ POST / — Créer un devis ============

describe('POST /api/quotes', () => {
  describe('Auth & Role guards', () => {
    it('retourne 401 sans token', async () => {
      const res = await request(app).post('/api/quotes').send({});
      expect(res.status).toBe(401);
    });

    it('retourne 403 si rôle CLIENT', async () => {
      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${clientToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(403);
    });
  });

  describe('Validation des champs', () => {
    it('retourne 400 si projectId manquant', async () => {
      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ description: 'desc', amount: 100000 });
      expect(res.status).toBe(400);
    });

    it('retourne 400 si description manquante', async () => {
      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, amount: 100000 });
      expect(res.status).toBe(400);
    });

    it('retourne 400 AMOUNT_REQUIRED si mode SIMPLE sans montant', async () => {
      setupProMock();
      prisma.quote.count.mockResolvedValue(0);
      prisma.quote.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', mode: 'SIMPLE' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AMOUNT_REQUIRED');
    });

    it('retourne 400 ITEMS_REQUIRED si mode DETAILED sans items', async () => {
      setupProMock();
      prisma.quote.count.mockResolvedValue(0);
      prisma.quote.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', mode: 'DETAILED', items: [] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ITEMS_REQUIRED');
    });
  });

  describe('Vérifications profil pro', () => {
    it('retourne 404 si profil pro introuvable', async () => {
      prisma.professional.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('PRO_PROFILE_NOT_FOUND');
    });

    it('retourne 403 IDENTITY_NOT_VERIFIED si pro non vérifié', async () => {
      setupProMock(false);

      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('IDENTITY_NOT_VERIFIED');
    });

    it('retourne 500 PROFILE_LOOKUP_ERROR si DB échoue sur professional lookup', async () => {
      prisma.professional.findUnique.mockRejectedValue(new Error('DB error'));

      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe('PROFILE_LOOKUP_ERROR');
    });
  });

  describe('Quota mensuel', () => {
    it('retourne 403 QUOTA_EXCEEDED si quota dépassé', async () => {
      setupProMock();
      prisma.quote.count.mockResolvedValue(5);

      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('QUOTA_EXCEEDED');
      expect(res.body.limitReached).toBe(true);
    });

    it('ne vérifie pas le quota si maxQuotesPerMonth est null (illimité)', async () => {
      setupProMock();
      getTierConfig.mockReturnValue({ label: 'Pro', maxQuotesPerMonth: null });
      prisma.quote.findFirst.mockResolvedValue(null);
      prisma.quote.create.mockResolvedValue(mockQuote);
      prisma.quote.findUnique.mockResolvedValue(mockQuote);
      prisma.quote.update.mockResolvedValue(mockQuote);

      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(201);
      expect(prisma.quote.count).not.toHaveBeenCalled();
    });

    it('retourne 500 QUOTA_CHECK_ERROR si count DB échoue', async () => {
      setupProMock();
      prisma.quote.count.mockRejectedValue(new Error('DB count error'));

      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe('QUOTA_CHECK_ERROR');
    });
  });

  describe('Devis en attente existant', () => {
    it('retourne 409 PENDING_QUOTE_EXISTS si devis pending déjà présent', async () => {
      setupProMock();
      prisma.quote.count.mockResolvedValue(0);
      prisma.quote.findFirst.mockResolvedValue(mockQuote);

      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PENDING_QUOTE_EXISTS');
    });
  });

  describe('Création réussie', () => {
    beforeEach(() => {
      setupProMock();
      prisma.quote.count.mockResolvedValue(0);
      prisma.quote.findFirst.mockResolvedValue(null);
      prisma.quote.create.mockResolvedValue(mockQuote);
      prisma.quote.findUnique.mockResolvedValue(mockQuote);
      prisma.quote.update.mockResolvedValue(mockQuote);
    });

    it('crée un devis SIMPLE avec succès — 201', async () => {
      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(QUOTE_ID);
    });

    it('crée un devis DETAILED avec items et calcule le total', async () => {
      prisma.quote.create.mockResolvedValue(mockDetailedQuote);
      prisma.quote.findUnique.mockResolvedValue(mockDetailedQuote);

      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({
          projectId: PROJECT_ID,
          description: 'desc détaillée',
          mode: 'DETAILED',
          items: [
            { label: 'Main d\'oeuvre', quantity: 2, unitPrice: 50000, category: 'LABOUR' },
            { label: 'Robinet', quantity: 2, unitPrice: 50000, category: 'MATERIALS' },
          ],
        });
      expect(res.status).toBe(201);
    });

    it('crée un devis avec validityDays personnalisé', async () => {
      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000, validityDays: 30 });
      expect(res.status).toBe(201);
      const createCall = prisma.quote.create.mock.calls[0][0];
      expect(createCall.data.validityDays).toBe(30);
    });

    it('génère le PDF en arrière-plan sans bloquer la réponse', async () => {
      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(201);
      await new Promise(r => setTimeout(r, 10));
      expect(generateQuotePdf).toHaveBeenCalled();
    });

    it('envoie une notification push au client', async () => {
      const res = await request(app)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${proToken()}`)
        .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
      expect(res.status).toBe(201);
      await new Promise(r => setTimeout(r, 10));
      expect(sendPushNotification).toHaveBeenCalled();
    });
  });
});

// ============ POST /:id/revise ============

describe('POST /api/quotes/:id/revise', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/revise`).send({});
    expect(res.status).toBe(401);
  });

  it('retourne 403 si rôle CLIENT', async () => {
    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ amount: 200000 });
    expect(res.status).toBe(403);
  });

  it('retourne 404 si profil pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 200000 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PRO_PROFILE_NOT_FOUND');
  });

  it('retourne 404 si devis introuvable', async () => {
    setupProMock();
    prisma.quote.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 200000 });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('QUOTE_NOT_FOUND');
  });

  it('retourne 403 ACCESS_DENIED si le devis appartient à un autre pro', async () => {
    setupProMock();
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      professionalId: 'autre-pro',
    });

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 200000 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  it('retourne 400 INVALID_QUOTE_STATUS si devis ACCEPTED', async () => {
    setupProMock();
    prisma.quote.findUnique.mockResolvedValue({ ...mockQuote, status: 'ACCEPTED' });

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 200000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_QUOTE_STATUS');
  });

  it('révise un devis PENDING avec succès — 201', async () => {
    setupProMock();
    prisma.quote.findUnique
      .mockResolvedValueOnce(mockQuote)      // parentQuote lookup
      .mockResolvedValueOnce(mockQuote);     // fullRevision lookup
    prisma.quote.findFirst.mockResolvedValue({ version: 1 });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'REVISED' });
    const newQuote = { ...mockQuote, id: 'quote-2', version: 2, status: 'PENDING' };
    prisma.quote.create.mockResolvedValue(newQuote);

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 200000, description: 'Devis révisé' });
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(2);
  });

  it('révise un devis REFUSED avec succès — 201', async () => {
    setupProMock();
    const refusedQuote = { ...mockQuote, status: 'REFUSED' };
    prisma.quote.findUnique
      .mockResolvedValueOnce(refusedQuote)
      .mockResolvedValueOnce(refusedQuote);
    prisma.quote.findFirst.mockResolvedValue({ version: 1 });
    prisma.quote.update.mockResolvedValue({ ...refusedQuote, status: 'REVISED' });
    prisma.quote.create.mockResolvedValue({ ...mockQuote, id: 'quote-2', version: 2 });

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 180000 });
    expect(res.status).toBe(201);
  });

  it('révise avec items DETAILED — calcule le montant à partir des items', async () => {
    setupProMock();
    const detailedParent = { ...mockDetailedQuote, status: 'PENDING', professionalId: PRO_ID };
    prisma.quote.findUnique
      .mockResolvedValueOnce(detailedParent)
      .mockResolvedValueOnce(detailedParent);
    prisma.quote.findFirst.mockResolvedValue({ version: 1 });
    prisma.quote.update.mockResolvedValue({ ...detailedParent, status: 'REVISED' });
    prisma.quote.create.mockResolvedValue({ ...detailedParent, id: 'quote-detailed-2', version: 2 });

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({
        mode: 'DETAILED',
        items: [{ label: 'Travaux', quantity: 1, unitPrice: 300000, category: 'LABOUR' }],
      });
    expect(res.status).toBe(201);
  });

  it('utilise le montant du parent si aucun amount ni items fournis', async () => {
    setupProMock();
    prisma.quote.findUnique
      .mockResolvedValueOnce(mockQuote)
      .mockResolvedValueOnce(mockQuote);
    prisma.quote.findFirst.mockResolvedValue({ version: 1 });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'REVISED' });
    prisma.quote.create.mockResolvedValue({ ...mockQuote, version: 2 });

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({});
    expect(res.status).toBe(201);
    const createArgs = prisma.quote.create.mock.calls[0][0];
    expect(createArgs.data.amount).toBe(mockQuote.amount);
  });
});

// ============ GET /:id/history ============

describe('GET /api/quotes/:id/history', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).get(`/api/quotes/${QUOTE_ID}/history`);
    expect(res.status).toBe(401);
  });

  it('retourne 404 si devis introuvable', async () => {
    prisma.quote.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/history`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('QUOTE_NOT_FOUND');
  });

  it('retourne 403 si ni client ni pro ni admin', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      project: { clientId: 'autre-client' },
      professional: { user: { id: 'autre-pro' } },
    });

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/history`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  it('retourne l\'historique au client propriétaire', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      project: { clientId: CLIENT_USER_ID },
      professional: { user: { id: PRO_USER_ID } },
    });
    prisma.quote.findMany.mockResolvedValue([mockQuote]);

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/history`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('retourne l\'historique au pro propriétaire', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      project: { clientId: CLIENT_USER_ID },
      professional: { user: { id: PRO_USER_ID } },
    });
    prisma.quote.findMany.mockResolvedValue([mockQuote]);

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/history`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('retourne l\'historique à un admin', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      project: { clientId: 'autre-client' },
      professional: { user: { id: 'autre-pro' } },
    });
    prisma.quote.findMany.mockResolvedValue([mockQuote]);

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/history`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ============ GET /mine ============

describe('GET /api/quotes/mine', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).get('/api/quotes/mine');
    expect(res.status).toBe(401);
  });

  it('retourne 403 si rôle CLIENT', async () => {
    const res = await request(app)
      .get('/api/quotes/mine')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 404 si profil pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/quotes/mine')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PRO_PROFILE_NOT_FOUND');
  });

  it('retourne 500 PROFILE_LOOKUP_ERROR si DB échoue', async () => {
    prisma.professional.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/quotes/mine')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('PROFILE_LOOKUP_ERROR');
  });

  it('retourne la liste des devis du pro', async () => {
    setupProMock();
    prisma.quote.findMany.mockResolvedValue([mockQuote]);

    const res = await request(app)
      .get('/api/quotes/mine')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(QUOTE_ID);
  });

  it('retourne liste vide si aucun devis', async () => {
    setupProMock();
    prisma.quote.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/quotes/mine')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ============ GET /:id ============

describe('GET /api/quotes/:id', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).get(`/api/quotes/${QUOTE_ID}`);
    expect(res.status).toBe(401);
  });

  it('retourne 404 si devis introuvable', async () => {
    prisma.quote.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('QUOTE_NOT_FOUND');
  });

  it('retourne 403 si ni client ni pro ni admin', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      project: { id: PROJECT_ID, title: 'Projet', clientId: 'autre-client' },
      professional: { user: { id: 'autre-pro' } },
    });

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  it('retourne le devis au client propriétaire', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      project: { id: PROJECT_ID, title: 'Projet', clientId: CLIENT_USER_ID },
      professional: { user: { id: PRO_USER_ID }, ...mockProfessional },
    });

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(QUOTE_ID);
  });

  it('retourne le devis au pro propriétaire', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      project: { id: PROJECT_ID, title: 'Projet', clientId: CLIENT_USER_ID },
      professional: { user: { id: PRO_USER_ID }, ...mockProfessional },
    });

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(QUOTE_ID);
  });

  it('retourne le devis à un admin', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      project: { id: PROJECT_ID, title: 'Projet', clientId: 'autre-client' },
      professional: { user: { id: 'autre-pro' }, ...mockProfessional },
    });

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
  });
});

// ============ DELETE /:id ============

describe('DELETE /api/quotes/:id', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).delete(`/api/quotes/${QUOTE_ID}`);
    expect(res.status).toBe(401);
  });

  it('retourne 403 si rôle CLIENT', async () => {
    const res = await request(app)
      .delete(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  it('retourne 404 si profil pro introuvable', async () => {
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PRO_PROFILE_NOT_FOUND');
  });

  it('retourne 403 ACCESS_DENIED si devis appartient à un autre pro', async () => {
    setupProMock();
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      professionalId: 'autre-pro',
    });

    const res = await request(app)
      .delete(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  it('retourne 403 ACCESS_DENIED si devis introuvable (findUnique null)', async () => {
    setupProMock();
    prisma.quote.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  it('retourne 400 INVALID_QUOTE_STATUS si devis non PENDING', async () => {
    setupProMock();
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'ACCEPTED',
    });

    const res = await request(app)
      .delete(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_QUOTE_STATUS');
  });

  it('supprime le devis PENDING avec succès', async () => {
    setupProMock();
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    prisma.quote.delete.mockResolvedValue(mockQuote);

    const res = await request(app)
      .delete(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
  });
});

// ============ PATCH /:id — Accepter/Refuser ============

describe('PATCH /api/quotes/:id', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).patch(`/api/quotes/${QUOTE_ID}`).send({ status: 'ACCEPTED' });
    expect(res.status).toBe(401);
  });

  it('retourne 403 si rôle PROFESSIONAL', async () => {
    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(403);
  });

  it('retourne 400 INVALID_STATUS si statut invalide', async () => {
    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'INVALID_VALUE' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_STATUS');
  });

  it('retourne 404 si devis introuvable', async () => {
    prisma.quote.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('QUOTE_NOT_FOUND');
  });

  it('retourne 403 ACCESS_DENIED si client non propriétaire du projet', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      project: { ...mockProject, clientId: 'autre-client' },
    });

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  it('retourne 400 QUOTE_ALREADY_PROCESSED si devis non PENDING', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'ACCEPTED',
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('QUOTE_ALREADY_PROCESSED');
  });

  it('retourne 400 QUOTE_EXPIRED si devis expiré', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1000),
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'EXPIRED' });

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('QUOTE_EXPIRED');
  });

  it('accepte le devis et met le projet en IN_PROGRESS', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    const acceptedQuote = { ...mockQuote, status: 'ACCEPTED' };
    prisma.quote.update.mockResolvedValue(acceptedQuote);
    prisma.project.update.mockResolvedValue({ ...mockProject, status: 'IN_PROGRESS' });
    prisma.professional.findUnique.mockResolvedValue({ userId: PRO_USER_ID });

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACCEPTED');
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { status: 'IN_PROGRESS' },
    });
  });

  it('refuse le devis sans mettre le projet en IN_PROGRESS', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    const refusedQuote = { ...mockQuote, status: 'REFUSED' };
    prisma.quote.update.mockResolvedValue(refusedQuote);
    prisma.professional.findUnique.mockResolvedValue({ userId: PRO_USER_ID });

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'REFUSED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REFUSED');
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('envoie notification push au pro après acceptation', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'ACCEPTED' });
    prisma.project.update.mockResolvedValue({ ...mockProject, status: 'IN_PROGRESS' });
    prisma.professional.findUnique.mockResolvedValue({ userId: PRO_USER_ID });

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    expect(sendPushNotification).toHaveBeenCalledWith(
      PRO_USER_ID,
      'Devis accepté !',
      expect.any(String),
      expect.objectContaining({ type: 'quote_response' }),
    );
  });

  it('fonctionne si professionnel introuvable lors de la notification', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'REFUSED' });
    // pro lookup pour notification retourne null
    prisma.professional.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'REFUSED' });
    expect(res.status).toBe(200);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });
});

// ============ POST /:id/pdf ============

describe('POST /api/quotes/:id/pdf', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).post(`/api/quotes/${QUOTE_ID}/pdf`);
    expect(res.status).toBe(401);
  });

  it('retourne 404 si devis introuvable', async () => {
    prisma.quote.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('QUOTE_NOT_FOUND');
  });

  it('retourne 403 si ni pro propriétaire ni client ni admin', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      professional: { ...mockProfessional, userId: 'autre-pro' },
      project: { ...mockProject, clientId: 'autre-client' },
    });

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  it('génère et retourne l\'URL PDF — pro propriétaire', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      professional: { ...mockProfessional, userId: PRO_USER_ID },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    generateQuotePdf.mockResolvedValue('https://cloudinary.com/test/devis.pdf');
    prisma.quote.update.mockResolvedValue(mockQuote);

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.pdfUrl).toBe('https://cloudinary.com/test/devis.pdf');
  });

  it('génère et retourne l\'URL PDF — client propriétaire', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      professional: { ...mockProfessional, userId: 'autre-pro' },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    generateQuotePdf.mockResolvedValue('https://cloudinary.com/test/devis.pdf');
    prisma.quote.update.mockResolvedValue(mockQuote);

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.pdfUrl).toBeTruthy();
  });

  it('retourne 503 PDF_GENERATION_ERROR si génération échoue', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      professional: { ...mockProfessional, userId: PRO_USER_ID },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    generateQuotePdf.mockRejectedValue(new Error('Cloudinary error'));

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PDF_GENERATION_ERROR');
  });

  it('retourne 200 même si sauvegarde URL échoue (non bloquant)', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      professional: { ...mockProfessional, userId: PRO_USER_ID },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    generateQuotePdf.mockResolvedValue('https://cloudinary.com/test/devis.pdf');
    prisma.quote.update.mockRejectedValue(new Error('DB save error'));

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.pdfUrl).toBe('https://cloudinary.com/test/devis.pdf');
  });
});

// ============ GET /:id/pdf ============

describe('GET /api/quotes/:id/pdf', () => {
  it('retourne 401 sans token', async () => {
    const res = await request(app).get(`/api/quotes/${QUOTE_ID}/pdf`);
    expect(res.status).toBe(401);
  });

  it('retourne 404 si devis introuvable', async () => {
    prisma.quote.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('QUOTE_NOT_FOUND');
  });

  it('retourne 403 si accès non autorisé', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      professional: { ...mockProfessional, userId: 'autre-pro' },
      project: { ...mockProject, clientId: 'autre-client' },
    });

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCESS_DENIED');
  });

  it('retourne l\'URL PDF existante si valide (http)', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      pdfUrl: 'https://cloudinary.com/test/devis.pdf',
      professional: { ...mockProfessional, userId: PRO_USER_ID },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.pdfUrl).toBe('https://cloudinary.com/test/devis.pdf');
    expect(generateQuotePdf).not.toHaveBeenCalled();
  });

  it('régénère le PDF si pdfUrl absent', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      pdfUrl: null,
      professional: { ...mockProfessional, userId: PRO_USER_ID },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    generateQuotePdf.mockResolvedValue('https://cloudinary.com/test/devis-regen.pdf');
    prisma.quote.update.mockResolvedValue(mockQuote);

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.pdfUrl).toBe('https://cloudinary.com/test/devis-regen.pdf');
    expect(generateQuotePdf).toHaveBeenCalled();
  });

  it('régénère le PDF si pdfUrl est un chemin local (ne commence pas par http)', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      pdfUrl: '/tmp/devis-local.pdf',
      professional: { ...mockProfessional, userId: PRO_USER_ID },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    generateQuotePdf.mockResolvedValue('https://cloudinary.com/test/devis-regen.pdf');
    prisma.quote.update.mockResolvedValue(mockQuote);

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(generateQuotePdf).toHaveBeenCalled();
  });

  it('retourne 503 PDF_GENERATION_ERROR si régénération échoue', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      pdfUrl: null,
      professional: { ...mockProfessional, userId: PRO_USER_ID },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    generateQuotePdf.mockRejectedValue(new Error('Cloudinary error'));

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PDF_GENERATION_ERROR');
  });

  it('stream le PDF en mémoire avec ?stream=1', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      pdfUrl: 'https://cloudinary.com/test/devis.pdf',
      version: 1,
      professional: { ...mockProfessional, userId: PRO_USER_ID },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    generateQuotePdf.generateQuotePdfBuffer.mockResolvedValue(Buffer.from('fake-pdf'));

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf?stream=1`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/inline/);
  });

  it('retourne 503 PDF_STREAM_ERROR si stream buffer échoue', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      pdfUrl: 'https://cloudinary.com/test/devis.pdf',
      version: 1,
      professional: { ...mockProfessional, userId: PRO_USER_ID },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    generateQuotePdf.generateQuotePdfBuffer.mockRejectedValue(new Error('Buffer error'));

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf?stream=1`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PDF_STREAM_ERROR');
  });

  it('admin peut accéder au PDF', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      pdfUrl: 'https://cloudinary.com/test/devis.pdf',
      professional: { ...mockProfessional, userId: 'autre-pro' },
      project: { ...mockProject, clientId: 'autre-client' },
    });

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.pdfUrl).toBe('https://cloudinary.com/test/devis.pdf');
  });
});

// ============ Couverture des blocs catch externes ============

describe('Blocs catch extérieurs (500 generiques)', () => {
  it('POST / retourne 500 QUOTE_CREATE_ERROR si prisma.quote.create plante', async () => {
    setupProMock();
    prisma.quote.count.mockResolvedValue(0);
    prisma.quote.findFirst.mockResolvedValue(null);
    prisma.quote.create.mockRejectedValue(new Error('DB create crash'));

    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('QUOTE_CREATE_ERROR');
  });

  it('POST /:id/revise retourne 500 QUOTE_REVISE_ERROR si prisma.quote.create plante', async () => {
    setupProMock();
    prisma.quote.findUnique
      .mockResolvedValueOnce(mockQuote)
      .mockResolvedValueOnce(mockQuote);
    prisma.quote.findFirst.mockResolvedValue({ version: 1 });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'REVISED' });
    prisma.quote.create.mockRejectedValue(new Error('DB revise crash'));

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 200000 });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('QUOTE_REVISE_ERROR');
  });

  it('GET /:id/history retourne 500 QUOTE_HISTORY_ERROR si prisma.quote.findMany plante', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      project: { clientId: CLIENT_USER_ID },
      professional: { user: { id: PRO_USER_ID } },
    });
    prisma.quote.findMany.mockRejectedValue(new Error('DB history crash'));

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/history`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('QUOTE_HISTORY_ERROR');
  });

  it('GET /mine retourne 500 MY_QUOTES_FETCH_ERROR si prisma.quote.findMany plante', async () => {
    setupProMock();
    prisma.quote.findMany.mockRejectedValue(new Error('DB mine crash'));

    const res = await request(app)
      .get('/api/quotes/mine')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('MY_QUOTES_FETCH_ERROR');
  });

  it('GET /:id retourne 500 QUOTE_DETAIL_FETCH_ERROR si prisma.quote.findUnique plante', async () => {
    prisma.quote.findUnique.mockRejectedValue(new Error('DB detail crash'));

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('QUOTE_DETAIL_FETCH_ERROR');
  });

  it('DELETE /:id retourne 500 QUOTE_DELETE_ERROR si prisma.quote.delete plante', async () => {
    setupProMock();
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    prisma.quote.delete.mockRejectedValue(new Error('DB delete crash'));

    const res = await request(app)
      .delete(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('QUOTE_DELETE_ERROR');
  });

  it('PATCH /:id retourne 500 QUOTE_RESPONSE_ERROR si prisma.quote.update plante', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    prisma.quote.update.mockRejectedValue(new Error('DB patch crash'));

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('QUOTE_RESPONSE_ERROR');
  });

  it('POST /:id/pdf retourne 500 PDF_PROCESSING_ERROR si prisma.quote.findUnique plante', async () => {
    prisma.quote.findUnique.mockRejectedValue(new Error('DB pdf crash'));

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('PDF_PROCESSING_ERROR');
  });

  it('GET /:id/pdf retourne 500 PDF_FETCH_ERROR si prisma.quote.findUnique plante', async () => {
    prisma.quote.findUnique.mockRejectedValue(new Error('DB get pdf crash'));

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('PDF_FETCH_ERROR');
  });
});

// ============ Couverture callbacks fire-and-forget ============

describe('Callbacks fire-and-forget', () => {
  it('POST / — le callback .then du PDF sauvegarde l\'URL', async () => {
    setupProMock();
    prisma.quote.count.mockResolvedValue(0);
    prisma.quote.findFirst.mockResolvedValue(null);
    prisma.quote.create.mockResolvedValue(mockQuote);
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    const updateSpy = prisma.quote.update.mockResolvedValue({ ...mockQuote, pdfUrl: 'https://cloudinary.com/test/devis.pdf' });
    generateQuotePdf.mockResolvedValue('https://cloudinary.com/test/devis.pdf');

    await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });

    // Attendre que le fire-and-forget se termine
    await new Promise(r => setTimeout(r, 50));
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: QUOTE_ID }, data: { pdfUrl: 'https://cloudinary.com/test/devis.pdf' } })
    );
  });

  it('POST / — le callback .catch du PDF est silencieux si génération échoue', async () => {
    setupProMock();
    prisma.quote.count.mockResolvedValue(0);
    prisma.quote.findFirst.mockResolvedValue(null);
    prisma.quote.create.mockResolvedValue(mockQuote);
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    generateQuotePdf.mockRejectedValue(new Error('PDF crash fire-and-forget'));

    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
    // La réponse 201 ne doit pas être impactée
    expect(res.status).toBe(201);
    await new Promise(r => setTimeout(r, 50));
  });

  it('POST /:id/revise — le callback .then du PDF sauvegarde l\'URL', async () => {
    setupProMock();
    prisma.quote.findUnique
      .mockResolvedValueOnce(mockQuote)
      .mockResolvedValueOnce({ ...mockQuote, id: 'quote-2', version: 2 });
    prisma.quote.findFirst.mockResolvedValue({ version: 1 });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'REVISED' });
    prisma.quote.create.mockResolvedValue({ ...mockQuote, id: 'quote-2', version: 2 });
    generateQuotePdf.mockResolvedValue('https://cloudinary.com/test/devis-v2.pdf');

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 200000 });
    expect(res.status).toBe(201);
    await new Promise(r => setTimeout(r, 50));
    expect(generateQuotePdf).toHaveBeenCalled();
  });

  it('POST /:id/revise — le callback .catch du PDF est silencieux', async () => {
    setupProMock();
    prisma.quote.findUnique
      .mockResolvedValueOnce(mockQuote)
      .mockResolvedValueOnce(mockQuote);
    prisma.quote.findFirst.mockResolvedValue({ version: 1 });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'REVISED' });
    prisma.quote.create.mockResolvedValue({ ...mockQuote, id: 'quote-2', version: 2 });
    generateQuotePdf.mockRejectedValue(new Error('PDF revise crash fire-and-forget'));

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 200000 });
    expect(res.status).toBe(201);
    await new Promise(r => setTimeout(r, 50));
  });

  it('PATCH /:id — le catch du project.update ne bloque pas la réponse', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'ACCEPTED' });
    prisma.project.update.mockRejectedValue(new Error('Project update crash'));
    prisma.professional.findUnique.mockResolvedValue({ userId: PRO_USER_ID });

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'ACCEPTED' });
    // La réponse doit quand même être 200 malgré l'échec du project.update
    expect(res.status).toBe(200);
  });

  it('PATCH /:id — le catch de l\'expiration update est silencieux', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1000),
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    // La mise à jour EXPIRED échoue silencieusement
    prisma.quote.update.mockRejectedValue(new Error('Expired update crash'));

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'ACCEPTED' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('QUOTE_EXPIRED');
  });

  it('GET /:id/pdf — save URL après régénération est silencieux si DB échoue', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      pdfUrl: null,
      professional: { ...mockProfessional, userId: PRO_USER_ID },
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    generateQuotePdf.mockResolvedValue('https://cloudinary.com/test/devis-regen.pdf');
    prisma.quote.update.mockRejectedValue(new Error('DB save url crash'));

    const res = await request(app)
      .get(`/api/quotes/${QUOTE_ID}/pdf`)
      .set('Authorization', `Bearer ${proToken()}`);
    // La réponse doit quand même renvoyer le pdfUrl
    expect(res.status).toBe(200);
    expect(res.body.pdfUrl).toBe('https://cloudinary.com/test/devis-regen.pdf');
  });
});

// ============ Couverture callbacks .catch push notifications ============

describe('Callbacks .catch push notifications (fire-and-forget)', () => {
  it('POST / — push notification .catch est silencieux si sendPushNotification rejette', async () => {
    setupProMock();
    prisma.quote.count.mockResolvedValue(0);
    prisma.quote.findFirst.mockResolvedValue(null);
    prisma.quote.create.mockResolvedValue(mockQuote);
    prisma.quote.findUnique.mockResolvedValue(mockQuote);
    prisma.quote.update.mockResolvedValue(mockQuote);
    generateQuotePdf.mockResolvedValue('https://cloudinary.com/test/devis.pdf');
    sendPushNotification.mockRejectedValue(new Error('Push crash POST /'));

    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ projectId: PROJECT_ID, description: 'desc', amount: 100000 });
    expect(res.status).toBe(201);
    await new Promise(r => setTimeout(r, 50));
  });

  it('POST /:id/revise — push notification .catch est silencieux si sendPushNotification rejette', async () => {
    setupProMock();
    prisma.quote.findUnique
      .mockResolvedValueOnce(mockQuote)
      .mockResolvedValueOnce(mockQuote);
    prisma.quote.findFirst.mockResolvedValue({ version: 1 });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'REVISED' });
    prisma.quote.create.mockResolvedValue({ ...mockQuote, id: 'quote-2', version: 2 });
    generateQuotePdf.mockResolvedValue('https://cloudinary.com/test/devis-v2.pdf');
    sendPushNotification.mockRejectedValue(new Error('Push crash revise'));

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 200000 });
    expect(res.status).toBe(201);
    await new Promise(r => setTimeout(r, 50));
  });

  it('PATCH /:id — push notification .catch est silencieux si sendPushNotification rejette', async () => {
    prisma.quote.findUnique.mockResolvedValue({
      ...mockQuote,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      project: { ...mockProject, clientId: CLIENT_USER_ID },
    });
    prisma.quote.update.mockResolvedValue({ ...mockQuote, status: 'REFUSED' });
    prisma.professional.findUnique.mockResolvedValue({ userId: PRO_USER_ID });
    sendPushNotification.mockRejectedValue(new Error('Push crash PATCH'));

    const res = await request(app)
      .patch(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ status: 'REFUSED' });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 50));
  });
});

// ============ Couverture inner catch PROFILE_LOOKUP_ERROR manquants ============

describe('Inner catch PROFILE_LOOKUP_ERROR — routes revise et delete', () => {
  it('POST /:id/revise retourne 500 PROFILE_LOOKUP_ERROR si professional DB plante', async () => {
    prisma.professional.findUnique.mockRejectedValue(new Error('DB revise pro crash'));

    const res = await request(app)
      .post(`/api/quotes/${QUOTE_ID}/revise`)
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ amount: 200000 });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('PROFILE_LOOKUP_ERROR');
  });

  it('DELETE /:id retourne 500 PROFILE_LOOKUP_ERROR si professional DB plante', async () => {
    prisma.professional.findUnique.mockRejectedValue(new Error('DB delete pro crash'));

    const res = await request(app)
      .delete(`/api/quotes/${QUOTE_ID}`)
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('PROFILE_LOOKUP_ERROR');
  });
});

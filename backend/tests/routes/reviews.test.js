const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

// ============ MOCKS ============

jest.mock('../../config/db', () => ({
  project: { findUnique: jest.fn() },
  review: {
    create: jest.fn(),
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
  professional: { update: jest.fn() },
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
const reviewRoutes = require('../../routes/reviews');

const app = express();
app.use(express.json());
app.use('/api/reviews', reviewRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ Fixtures ============

const CLIENT_ID = 'client-1';
const PRO_ID = 'pro-id-1';
const PROJECT_ID = 'project-1';

const mockProject = {
  id: PROJECT_ID,
  clientId: CLIENT_ID,
  status: 'COMPLETED',
  review: null,
  quotes: [{ id: 'quote-1' }],
};

const mockReview = {
  id: 'review-1',
  authorId: CLIENT_ID,
  professionalId: PRO_ID,
  rating: 4,
  comment: 'Très bon travail',
  projectId: PROJECT_ID,
  createdAt: new Date().toISOString(),
};

// ============ POST /api/reviews ============

describe('POST /api/reviews', () => {
  beforeEach(() => {
    prisma.project.findUnique.mockResolvedValue(mockProject);
    prisma.review.create.mockResolvedValue(mockReview);
    prisma.review.aggregate.mockResolvedValue({ _avg: { rating: 4 }, _count: 1 });
    prisma.professional.update.mockResolvedValue({});
  });

  test('201 — crée un avis avec succès', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID, comment: 'Très bon travail' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', 'review-1');
    expect(res.body.rating).toBe(4);
  });

  test('201 — sans commentaire (optionnel)', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 5, projectId: PROJECT_ID });

    expect(res.status).toBe(201);
  });

  test('met à jour la note moyenne du professionnel après création', async () => {
    await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID });

    expect(prisma.professional.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PRO_ID },
        data: expect.objectContaining({ averageRating: expect.any(Number) }),
      })
    );
  });

  test('401 — sans token', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID });

    expect(res.status).toBe(401);
  });

  test('403 — un professionnel ne peut pas laisser d\'avis', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${proToken()}`)
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID });

    expect(res.status).toBe(403);
  });

  test('400 — rating manquant (validation)', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, projectId: PROJECT_ID });

    expect(res.status).toBe(400);
  });

  test('400 — professionalId manquant (validation)', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ rating: 4, projectId: PROJECT_ID });

    expect(res.status).toBe(400);
  });

  test('400 — projectId manquant (validation)', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 4 });

    expect(res.status).toBe(400);
  });

  test('400 — rating hors bornes (0)', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 0, projectId: PROJECT_ID });

    expect(res.status).toBe(400);
  });

  test('400 — rating hors bornes (6)', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 6, projectId: PROJECT_ID });

    expect(res.status).toBe(400);
  });

  test('400 — commentaire trop long', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID, comment: 'x'.repeat(1001) });

    expect(res.status).toBe(400);
  });

  test('403 — le projet n\'appartient pas au client connecté', async () => {
    prisma.project.findUnique.mockResolvedValue({
      ...mockProject,
      clientId: 'other-client',
    });

    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID });

    expect(res.status).toBe(403);
  });

  test('400 — la mission n\'est pas encore terminée', async () => {
    prisma.project.findUnique.mockResolvedValue({ ...mockProject, status: 'IN_PROGRESS' });

    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/terminée/i);
  });

  test('409 — avis déjà laissé pour cette mission', async () => {
    prisma.project.findUnique.mockResolvedValue({
      ...mockProject,
      review: { id: 'existing-review' },
    });

    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/déjà laissé/i);
  });

  test('403 — aucune mission avec ce professionnel', async () => {
    prisma.project.findUnique.mockResolvedValue({ ...mockProject, quotes: [] });

    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/mission/i);
  });

  test('403 — projet introuvable (project null)', async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID });

    expect(res.status).toBe(403);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.project.findUnique.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`)
      .send({ professionalId: PRO_ID, rating: 4, projectId: PROJECT_ID });

    expect(res.status).toBe(500);
  });
});

// ============ GET /api/reviews/professional/:id ============

describe('GET /api/reviews/professional/:id', () => {
  beforeEach(() => {
    prisma.review.findMany.mockResolvedValue([
      {
        id: 'review-1',
        rating: 5,
        comment: 'Excellent',
        createdAt: new Date().toISOString(),
        author: { firstName: 'Marie', lastName: 'Dupont' },
      },
    ]);
  });

  test('200 — retourne les avis du professionnel', async () => {
    const res = await request(app)
      .get(`/api/reviews/professional/${PRO_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('rating', 5);
  });

  test('200 — retourne liste vide si aucun avis', async () => {
    prisma.review.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/reviews/professional/${PRO_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('200 — un professionnel peut voir les avis d\'un autre pro', async () => {
    const res = await request(app)
      .get(`/api/reviews/professional/${PRO_ID}`)
      .set('Authorization', `Bearer ${proToken()}`);

    expect(res.status).toBe(200);
  });

  test('respecte la pagination (page et limit)', async () => {
    await request(app)
      .get(`/api/reviews/professional/${PRO_ID}?page=2&limit=10`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 10 })
    );
  });

  test('plafonne limit à 50', async () => {
    await request(app)
      .get(`/api/reviews/professional/${PRO_ID}?limit=200`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  test('401 — sans token', async () => {
    const res = await request(app).get(`/api/reviews/professional/${PRO_ID}`);
    expect(res.status).toBe(401);
  });

  test('500 — erreur base de données propagée', async () => {
    prisma.review.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get(`/api/reviews/professional/${PRO_ID}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_ID)}`);

    expect(res.status).toBe(500);
  });
});

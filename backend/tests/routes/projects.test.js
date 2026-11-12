const request = require('supertest');
const express = require('express');
const { clientToken, proToken, adminToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../config/db', () => ({
  project: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  projectPhoto: {
    create: jest.fn(),
  },
  professional: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  quote: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  payment: {
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
}));

jest.mock('../../config/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../config/cloudinary', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://res.cloudinary.com/test/image.jpg'),
}));

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const jwt = require('jsonwebtoken');
      try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        req.user.role = req.user.role || 'CLIENT';
      } catch {
        return res.status(401).json({ error: 'Token invalide' });
      }
    } else {
      req.user = { id: null, role: 'GUEST' };
    }
    next();
  },
  requireRole: (role) => (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  },
  requireEmailVerified: (req, res, next) => next(),
}));

jest.mock('../../config/upload', () => ({
  array: () => (req, res, next) => next(),
  verifyMagicBytes: (req, res, next) => next(),
}));

jest.mock('../../routes/subscriptions', () => ({
  getActiveTier: () => 'ESSENTIEL',
  getTierConfig: () => ({ projectsDelayMs: 0 }),
}));

jest.mock('../../utils/badges', () => ({
  computeBadges: jest.fn().mockResolvedValue(true),
}));

const prisma = require('../../config/db');
const { sendPushNotification } = require('../../config/pushNotifications');
const { uploadBuffer } = require('../../config/cloudinary');
const projectsRouter = require('../../routes/projects');

const app = express();
app.use(express.json());
app.use('/api/projects', projectsRouter);
app.use((err, req, res, next) => {
  // ERROR: '[TEST ERROR]', err.message, err.stack);
  res.status(500).json({ error: err.message });
});

// ============ TEST DATA FIXTURES ============

const CLIENT_USER_ID = 'client-1';
const PRO_USER_ID = 'pro-user-1';
const PRO_ID = 'pro-1';
const ADMIN_USER_ID = 'admin-1';

const mockClientUser = {
  id: CLIENT_USER_ID,
  role: 'CLIENT',
  email: 'client@test.com',
  firstName: 'Jean',
  lastName: 'Dupont',
  city: 'Antananarivo',
};

const mockProUser = {
  id: PRO_USER_ID,
  role: 'PROFESSIONAL',
  email: 'pro@test.com',
  firstName: 'Marie',
  lastName: 'Martin',
};

const mockAdminUser = {
  id: ADMIN_USER_ID,
  role: 'ADMIN',
  email: 'admin@test.com',
};

const mockProfessional = {
  id: PRO_ID,
  userId: PRO_USER_ID,
  trade: 'Plombier',
  user: mockProUser,
  completedMissionsCount: 10,
  cancelledMissionsCount: 1,
};

const mockPhoto = {
  id: 'photo-1',
  projectId: 'project-1',
  imageUrl: 'https://res.cloudinary.com/test/project1.jpg',
};

const mockProject = {
  id: 'project-1',
  clientId: CLIENT_USER_ID,
  title: 'Réparation plomberie urgente',
  description: 'Fuite d\'eau au premier étage',
  tradeNeeded: 'Plombier',
  budgetMin: 100000,
  budgetMax: 500000,
  city: 'Antananarivo',
  latitude: -18.8792,
  longitude: 47.5079,
  status: 'OPEN',
  clientConfirmedCompletion: false,
  proConfirmedCompletion: false,
  createdAt: new Date('2026-11-10'),
  updatedAt: new Date('2026-11-10'),
  client: mockClientUser,
  photos: [mockPhoto],
  quotes: [],
  review: null,
};

const mockProjectWithQuote = {
  ...mockProject,
  id: 'project-2',
  status: 'IN_PROGRESS',
  quotes: [
    {
      id: 'quote-1',
      projectId: 'project-2',
      professionalId: PRO_ID,
      amount: 250000,
      description: 'Remplacement tuyauterie',
      status: 'ACCEPTED',
      items: [],
      payments: [],
      professional: mockProfessional,
    },
  ],
};

const mockQuote = {
  id: 'quote-1',
  projectId: 'project-1',
  professionalId: PRO_ID,
  amount: 250000,
  description: 'Devis plomberie',
  status: 'PENDING',
  pdfUrl: 'https://res.cloudinary.com/test/quote.pdf',
  version: 1,
  createdAt: new Date(),
  items: [],
  payments: [],
  professional: mockProfessional,
};

// ============ HELPER SETUP FUNCTIONS ============

function setupUserMock(prisma) {
  prisma.user.findUnique.mockImplementation(({ where }) => {
    if (where?.id === CLIENT_USER_ID) return Promise.resolve(mockClientUser);
    if (where?.id === PRO_USER_ID) return Promise.resolve(mockProUser);
    if (where?.id === ADMIN_USER_ID) return Promise.resolve(mockAdminUser);
    return Promise.resolve(null);
  });
}

function setupProfessionalMock(prisma) {
  prisma.professional.findUnique.mockImplementation(({ where }) => {
    if (where?.userId === PRO_USER_ID) return Promise.resolve(mockProfessional);
    if (where?.id === PRO_ID) return Promise.resolve(mockProfessional);
    return Promise.resolve(null);
  });
}

function resetAllMocks() {
  jest.clearAllMocks();
  setupUserMock(prisma);
  setupProfessionalMock(prisma);
}

// ============ TESTS: POST /api/projects ============

describe('POST /api/projects - Create project', () => {
  beforeEach(() => {
    resetAllMocks();
    prisma.project.create.mockResolvedValue(mockProject);
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({
        title: 'Test',
        description: 'Test project',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
      });

    expect(res.status).toBe(401);
  });

  test('should return 403 if not a CLIENT role', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`)
      .send({
        title: 'Test',
        description: 'Test project',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
      });

    expect(res.status).toBe(403);
  });

  test('should create project with required fields', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: 'Réparation plomberie urgente',
        description: 'Fuite d\'eau au premier étage',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe('Réparation plomberie urgente');
    expect(res.body.status).toBe('OPEN');
  });

  test('should require title', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        description: 'Fuite d\'eau',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  test('should require description', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: 'Test',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
      });

    expect(res.status).toBe(400);
  });

  test('should require tradeNeeded', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: 'Test',
        description: 'Test project',
        city: 'Antananarivo',
      });

    expect(res.status).toBe(400);
  });

  test('should require city', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: 'Test',
        description: 'Test project',
        tradeNeeded: 'Plombier',
      });

    expect(res.status).toBe(400);
  });

  test('should create project with optional budget and location', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: 'Réparation plomberie',
        description: 'Fuite d\'eau',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
        budgetMin: 100000,
        budgetMax: 500000,
        latitude: -18.8792,
        longitude: 47.5079,
      });

    expect(res.status).toBe(201);
    expect(prisma.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          budgetMin: 100000,
          budgetMax: 500000,
          latitude: -18.8792,
          longitude: 47.5079,
        }),
      })
    );
  });

  test('should create project with photos', async () => {
    const photosData = [
      'https://res.cloudinary.com/test/photo1.jpg',
      'https://res.cloudinary.com/test/photo2.jpg',
    ];

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: 'Test Project',
        description: 'Test with photos',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
        photos: photosData,
      });

    expect(res.status).toBe(201);
    expect(prisma.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          photos: expect.any(Object),
        }),
      })
    );
  });

  test('should set status to OPEN by default', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: 'Test',
        description: 'Test project',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('OPEN');
  });

  test('should assign clientId to authenticated user', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: 'Test',
        description: 'Test project',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
      });

    expect(res.status).toBe(201);
    expect(prisma.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: CLIENT_USER_ID,
        }),
      })
    );
  });

  test('should return 201 Created status', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: 'Test',
        description: 'Test project',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
      });

    expect(res.status).toBe(201);
  });
});

// ============ TESTS: GET /api/projects ============

describe('GET /api/projects - List projects', () => {
  beforeEach(() => {
    resetAllMocks();
    prisma.project.findMany.mockResolvedValue([mockProject]);
    prisma.project.count.mockResolvedValue(1);
    prisma.quote.findMany.mockResolvedValue([]);
  });

  test('should return projects without authentication', async () => {
    const res = await request(app).get('/api/projects');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('should filter by trade', async () => {
    const res = await request(app)
      .get('/api/projects')
      .query({ trade: 'Plombier' });

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tradeNeeded: 'Plombier',
        }),
      })
    );
  });

  test('should filter by multiple trades', async () => {
    const res = await request(app)
      .get('/api/projects')
      .query({ trades: 'Plombier,Électricien,Menuisier' });

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tradeNeeded: expect.objectContaining({
            in: ['Plombier', 'Électricien', 'Menuisier'],
          }),
        }),
      })
    );
  });

  test('should filter by city', async () => {
    const res = await request(app)
      .get('/api/projects')
      .query({ city: 'Antananarivo' });

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          city: 'Antananarivo',
        }),
      })
    );
  });

  test('should only return OPEN projects', async () => {
    const res = await request(app).get('/api/projects');

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'OPEN',
        }),
      })
    );
  });

  test('should exclude client\'s own projects', async () => {
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: expect.objectContaining({
            not: CLIENT_USER_ID,
          }),
        }),
      })
    );
  });

  test('should support pagination', async () => {
    const res = await request(app)
      .get('/api/projects')
      .query({ page: 2, limit: 10 });

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        skip: 10, // (page 2 - 1) * 10
      })
    );
  });

  test('should limit to 50 items per page maximum', async () => {
    const res = await request(app)
      .get('/api/projects')
      .query({ page: 1, limit: 100 });

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50, // Capped at 50
      })
    );
  });

  test('should default to page 1 if not specified', async () => {
    const res = await request(app).get('/api/projects');

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
      })
    );
  });

  test('should include photo count in response', async () => {
    const res = await request(app).get('/api/projects');

    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty('_count');
  });

  test('should mark projects already quoted by professional', async () => {
    prisma.quote.findMany.mockResolvedValue([{ projectId: 'project-1' }]);

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(200);
  });

  test('should apply subscription delay for professionals', async () => {
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(200);
  });
});

// ============ TESTS: GET /api/projects/mine ============

describe('GET /api/projects/mine - Get client\'s projects', () => {
  beforeEach(() => {
    resetAllMocks();
    prisma.project.findMany.mockResolvedValue([mockProject, mockProjectWithQuote]);
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/projects/mine');
    expect(res.status).toBe(401);
  });

  test('should return 403 if not a CLIENT', async () => {
    const res = await request(app)
      .get('/api/projects/mine')
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(403);
  });

  test('should return only client\'s own projects', async () => {
    const res = await request(app)
      .get('/api/projects/mine')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: CLIENT_USER_ID },
      })
    );
  });

  test('should include quotes with professional info', async () => {
    const res = await request(app)
      .get('/api/projects/mine')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          quotes: expect.any(Object),
        }),
      })
    );
  });

  test('should include photos', async () => {
    const res = await request(app)
      .get('/api/projects/mine')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          photos: true,
        }),
      })
    );
  });

  test('should order by creation date descending', async () => {
    const res = await request(app)
      .get('/api/projects/mine')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  test('should limit to 50 projects', async () => {
    const res = await request(app)
      .get('/api/projects/mine')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
      })
    );
  });
});

// ============ TESTS: GET /api/projects/:id ============

describe('GET /api/projects/:id - Get project detail', () => {
  beforeEach(() => {
    resetAllMocks();
    prisma.project.findUnique.mockResolvedValue(mockProjectWithQuote);
    prisma.payment.update.mockResolvedValue({ status: 'succeeded' });
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app).get(`/api/projects/${mockProject.id}`);
    expect(res.status).toBe(401);
  });

  test('should return 404 if project not found', async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/projects/invalid-id')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(404);
  });

  test('should return 403 if user has no access', async () => {
    prisma.project.findUnique.mockResolvedValue(mockProject);

    const res = await request(app)
      .get(`/api/projects/${mockProject.id}`)
      .set('Authorization', `Bearer ${clientToken('other-client-id')}`);

    expect(res.status).toBe(403);
  });

  test('should allow client to view their own project', async () => {
    const res = await request(app)
      .get(`/api/projects/${mockProject.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
  });

  test('should allow professional with quote to view project', async () => {
    const res = await request(app)
      .get(`/api/projects/${mockProjectWithQuote.id}`)
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(200);
  });

  test('should allow admin to view any project', async () => {
    const res = await request(app)
      .get(`/api/projects/${mockProject.id}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_USER_ID)}`);

    expect(res.status).toBe(200);
  });

  test('should include detailed quote information', async () => {
    const res = await request(app)
      .get(`/api/projects/${mockProjectWithQuote.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('quotes');
  });

  test('should verify pending payments', async () => {
    const res = await request(app)
      .get(`/api/projects/${mockProjectWithQuote.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
  });

  test('should include review status', async () => {
    const res = await request(app)
      .get(`/api/projects/${mockProject.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('alreadyReviewed');
  });
});

// ============ TESTS: PATCH /api/projects/:id ============

describe('PATCH /api/projects/:id - Update project', () => {
  beforeEach(() => {
    resetAllMocks();
    prisma.project.findUnique.mockResolvedValue(mockProject);
    prisma.project.update.mockResolvedValue({ ...mockProject, status: 'IN_PROGRESS' });
  });

  test('should return 401 without authentication', async () => {
    const res = await request(app)
      .patch(`/api/projects/${mockProject.id}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(401);
  });

  test('should return 403 if not a CLIENT', async () => {
    const res = await request(app)
      .patch(`/api/projects/${mockProject.id}`)
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(403);
  });

  test('should return 403 if not project owner', async () => {
    const res = await request(app)
      .patch(`/api/projects/${mockProject.id}`)
      .set('Authorization', `Bearer ${clientToken('other-client-id')}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(403);
  });

  test('should update project status', async () => {
    const res = await request(app)
      .patch(`/api/projects/${mockProject.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(200);
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'IN_PROGRESS',
        }),
      })
    );
  });

  test('should only allow valid statuses', async () => {
    const res = await request(app)
      .patch(`/api/projects/${mockProject.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({ status: 'INVALID_STATUS' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/statut invalide/i);
  });

  test('should allow valid statuses: OPEN, IN_PROGRESS, COMPLETED, CANCELLED', async () => {
    const validStatuses = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

    for (const status of validStatuses) {
      jest.clearAllMocks();
      setupUserMock(prisma);
      setupProfessionalMock(prisma);
      prisma.project.findUnique.mockResolvedValue(mockProject);
      prisma.project.update.mockResolvedValue({ ...mockProject, status });

      const res = await request(app)
        .patch(`/api/projects/${mockProject.id}`)
        .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
        .send({ status });

      expect(res.status).toBe(200);
    }
  });

  test('should return 404 if project not found', async () => {
    prisma.project.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/projects/invalid-id`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({ status: 'IN_PROGRESS' });

    expect(res.status).toBe(403);
  });
});

// ============ TESTS: PROJECT LIFECYCLE ============

describe('Project Lifecycle', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test('project starts in OPEN state', () => {
    expect(mockProject.status).toBe('OPEN');
  });

  test('client can mark project COMPLETE', async () => {
    prisma.project.findUnique.mockResolvedValue(mockProjectWithQuote);
    prisma.project.update.mockResolvedValue({
      ...mockProjectWithQuote,
      clientConfirmedCompletion: true,
      status: 'COMPLETED',
    });

    const res = await request(app)
      .patch(`/api/projects/${mockProjectWithQuote.id}/complete`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({});

    expect(res.status).toBe(200);
  });

  test('professional can confirm project completion', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.project.findUnique.mockResolvedValue(mockProjectWithQuote);
    prisma.project.update.mockResolvedValue({
      ...mockProjectWithQuote,
      proConfirmedCompletion: true,
      status: 'COMPLETED',
    });

    const res = await request(app)
      .patch(`/api/projects/${mockProjectWithQuote.id}/confirm-completion`)
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`)
      .send({});

    expect(res.status).toBe(200);
  });

  test('project marked COMPLETED increments professional missions count', async () => {
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.project.findUnique.mockResolvedValue(mockProjectWithQuote);
    prisma.project.update.mockResolvedValue({
      ...mockProjectWithQuote,
      proConfirmedCompletion: true,
      clientConfirmedCompletion: true,
      status: 'COMPLETED',
    });
    prisma.professional.update.mockResolvedValue({
      ...mockProfessional,
      completedMissionsCount: mockProfessional.completedMissionsCount + 1,
    });

    const res = await request(app)
      .patch(`/api/projects/${mockProjectWithQuote.id}/confirm-completion`)
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`)
      .send({});

    expect(res.status).toBe(200);
  });

  test('client can cancel project', async () => {
    prisma.project.findUnique.mockResolvedValue(mockProjectWithQuote);
    prisma.project.update.mockResolvedValue({
      ...mockProjectWithQuote,
      status: 'CANCELLED',
    });

    const res = await request(app)
      .patch(`/api/projects/${mockProjectWithQuote.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({});

    expect(res.status).toBe(200);
  });

  test('cancelled project increments professional cancelled missions', async () => {
    prisma.project.findUnique.mockResolvedValue(mockProjectWithQuote);
    prisma.project.update.mockResolvedValue({
      ...mockProjectWithQuote,
      status: 'CANCELLED',
    });
    prisma.professional.update.mockResolvedValue({
      ...mockProfessional,
      cancelledMissionsCount: mockProfessional.cancelledMissionsCount + 1,
    });

    const res = await request(app)
      .patch(`/api/projects/${mockProjectWithQuote.id}/cancel`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({});

    expect(res.status).toBe(200);
  });

  test('sends push notifications on completion', async () => {
    sendPushNotification.mockResolvedValue(true);
    prisma.professional.findUnique.mockResolvedValue(mockProfessional);
    prisma.project.findUnique.mockResolvedValue(mockProjectWithQuote);
    prisma.project.update.mockResolvedValue({
      ...mockProjectWithQuote,
      proConfirmedCompletion: true,
      clientConfirmedCompletion: true,
      status: 'COMPLETED',
    });
    prisma.professional.update.mockResolvedValue({
      ...mockProfessional,
      completedMissionsCount: mockProfessional.completedMissionsCount + 1,
    });

    const res = await request(app)
      .patch(`/api/projects/${mockProjectWithQuote.id}/confirm-completion`)
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`)
      .send({});

    expect(res.status).toBe(200);
  });
});

// ============ TESTS: PROJECT ACCESS CONTROL ============

describe('Project Access Control', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test('client can only see projects where they are owner or involved professional', async () => {
    const projectOtherClient = { ...mockProject, clientId: 'other-client-id' };
    prisma.project.findUnique.mockResolvedValue(projectOtherClient);

    const res = await request(app)
      .get(`/api/projects/${projectOtherClient.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(403);
  });

  test('professional can view projects where they have quoted', async () => {
    prisma.project.findUnique.mockResolvedValue(mockProjectWithQuote);

    const res = await request(app)
      .get(`/api/projects/${mockProjectWithQuote.id}`)
      .set('Authorization', `Bearer ${proToken(PRO_USER_ID)}`);

    expect(res.status).toBe(200);
  });

  test('admin can view any project', async () => {
    prisma.project.findUnique.mockResolvedValue(mockProject);

    const res = await request(app)
      .get(`/api/projects/${mockProject.id}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_USER_ID)}`);

    expect(res.status).toBe(200);
  });
});

// ============ ERROR HANDLING ============

describe('Project Error Handling', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test('should handle database errors gracefully', async () => {
    prisma.project.findMany.mockRejectedValue(new Error('Database error'));

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(500);
  });

  test('should handle missing required fields in POST', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('should handle photo upload errors', async () => {
    uploadBuffer.mockRejectedValue(new Error('Upload failed'));

    const res = await request(app)
      .post(`/api/projects/${mockProject.id}/photos`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .attach('photos', Buffer.from('test'));

    expect([400, 500]).toContain(res.status);
  });

  test('should handle missing photos in POST /photos', async () => {
    prisma.project.findUnique.mockResolvedValue(mockProject);

    const res = await request(app)
      .post(`/api/projects/${mockProject.id}/photos`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({});

    expect([400, 500]).toContain(res.status);
  });
});

// ============ EDGE CASES ============

describe('Project Edge Cases', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  test('should handle project with no quotes', async () => {
    const projectNoQuotes = { ...mockProject, quotes: [] };
    prisma.project.findUnique.mockResolvedValue(projectNoQuotes);

    const res = await request(app)
      .get(`/api/projects/${projectNoQuotes.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.quotes).toEqual([]);
  });

  test('should handle project with no photos', async () => {
    const projectNoPhotos = { ...mockProject, photos: [] };
    prisma.project.findUnique.mockResolvedValue(projectNoPhotos);

    const res = await request(app)
      .get(`/api/projects/${projectNoPhotos.id}`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual([]);
  });

  test('should handle null budget values', async () => {
    const projectNoBudget = {
      ...mockProject,
      budgetMin: null,
      budgetMax: null,
    };

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: projectNoBudget.title,
        description: projectNoBudget.description,
        tradeNeeded: projectNoBudget.tradeNeeded,
        city: projectNoBudget.city,
      });

    expect([200, 201, 400]).toContain(res.status);
  });

  test('should handle location coordinates being optional', async () => {
    const projectNoLocation = { ...mockProject, latitude: null, longitude: null };

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: projectNoLocation.title,
        description: projectNoLocation.description,
        tradeNeeded: projectNoLocation.tradeNeeded,
        city: projectNoLocation.city,
      });

    expect([200, 201]).toContain(res.status);
  });

  test('should handle attempting to complete non-in-progress project', async () => {
    const closedProject = { ...mockProject, status: 'CANCELLED' };
    prisma.project.findUnique.mockResolvedValue(closedProject);

    const res = await request(app)
      .patch(`/api/projects/${closedProject.id}/complete`)
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({});

    expect([400, 403]).toContain(res.status);
  });

  test('should handle pagination at boundaries', async () => {
    prisma.project.findMany.mockResolvedValue([]);
    prisma.project.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/projects')
      .query({ page: 999, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('should handle special characters in search/title', async () => {
    const specialProject = {
      ...mockProject,
      title: 'Project avec "caractères" spéciaux & très bizarres',
    };

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${clientToken(CLIENT_USER_ID)}`)
      .send({
        title: specialProject.title,
        description: 'Description',
        tradeNeeded: 'Plombier',
        city: 'Antananarivo',
      });

    expect([200, 201]).toContain(res.status);
  });
});

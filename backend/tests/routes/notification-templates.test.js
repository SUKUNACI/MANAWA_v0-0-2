const request = require('supertest');
const express = require('express');
const { clientToken, adminToken, proToken } = require('../helpers');

// ============ MOCK SETUP ============

jest.mock('../../config/db', () => ({
  notificationTemplate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
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
  getSortableFields: jest.fn().mockReturnValue(['id', 'name', 'createdAt']),
}));

jest.mock('../../utils/pagination-helper', () => ({
  validatePageBasedPaginationQuery: jest.fn().mockReturnValue([]),
  applyPageBasedPagination: jest.fn().mockReturnValue({ limit: 20, skip: 0, offset: 0 }),
  buildPaginatedResponse: jest.fn().mockImplementation((data, limit, offset, total) => ({
    data,
    pagination: { total, limit, offset },
  })),
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
const templatesRouter = require('../../routes/notification-templates');

const app = express();
app.use(express.json());
app.use('/api/admin/notification-templates', templatesRouter);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ============ FIXTURES ============

const ADMIN_ID = 'admin-1';
const TEMPLATE_NAME = 'welcome-email';

const mockTemplate = {
  id: 'tpl-1',
  name: TEMPLATE_NAME,
  type: 'EMAIL',
  language: 'fr',
  title: 'Bienvenue sur MANAWA',
  body: 'Bonjour {{firstName}}, bienvenue !',
  variables: ['firstName'],
  version: 1,
  isActive: true,
  createdAt: new Date().toISOString(),
};

const mockTemplateV2 = {
  ...mockTemplate,
  id: 'tpl-2',
  version: 2,
  title: 'Bienvenue sur MANAWA v2',
  isActive: true,
};

// ============ GET / ============

describe('GET /api/admin/notification-templates', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).get('/api/admin/notification-templates');
    expect(res.status).toBe(401);
  });

  test('403 — CLIENT ne peut pas accéder', async () => {
    const res = await request(app)
      .get('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin access required/i);
  });

  test('403 — PROFESSIONAL ne peut pas accéder', async () => {
    const res = await request(app)
      .get('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${proToken()}`);
    expect(res.status).toBe(403);
  });

  test('200 — admin récupère la liste des templates', async () => {
    prisma.notificationTemplate.findMany.mockResolvedValue([mockTemplate]);
    prisma.notificationTemplate.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.notificationTemplate.findMany).toHaveBeenCalled();
    expect(prisma.notificationTemplate.count).toHaveBeenCalled();
  });

  test('200 — filtre par language=fr', async () => {
    prisma.notificationTemplate.findMany.mockResolvedValue([mockTemplate]);
    prisma.notificationTemplate.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/admin/notification-templates?language=fr')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.notificationTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ language: 'fr' }) })
    );
  });

  test('200 — filtre par isActive=true', async () => {
    prisma.notificationTemplate.findMany.mockResolvedValue([mockTemplate]);
    prisma.notificationTemplate.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/admin/notification-templates?isActive=true')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(prisma.notificationTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) })
    );
  });

  test('400 — language invalide', async () => {
    const res = await request(app)
      .get('/api/admin/notification-templates?language=zh')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);
    expect(res.status).toBe(400);
  });

  test('400 — isActive invalide', async () => {
    const res = await request(app)
      .get('/api/admin/notification-templates?isActive=maybe')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);
    expect(res.status).toBe(400);
  });

  test('500 — erreur DB', async () => {
    prisma.notificationTemplate.findMany.mockRejectedValue(new Error('DB error'));
    prisma.notificationTemplate.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ GET /:id ============

describe('GET /api/admin/notification-templates/:id', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).get(`/api/admin/notification-templates/${TEMPLATE_NAME}`);
    expect(res.status).toBe(401);
  });

  test('403 — CLIENT ne peut pas accéder', async () => {
    const res = await request(app)
      .get(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  test('404 — template introuvable', async () => {
    prisma.notificationTemplate.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/notification-templates/inexistant')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('200 — retourne le template et ses versions', async () => {
    prisma.notificationTemplate.findMany.mockResolvedValue([mockTemplateV2, mockTemplate]);

    const res = await request(app)
      .get(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('templates');
    expect(res.body).toHaveProperty('current');
    expect(res.body).toHaveProperty('totalVersions', 2);
  });

  test('200 — current pointe sur la version active', async () => {
    const inactiveV1 = { ...mockTemplate, isActive: false };
    prisma.notificationTemplate.findMany.mockResolvedValue([mockTemplateV2, inactiveV1]);

    const res = await request(app)
      .get(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.current.version).toBe(2);
  });

  test('500 — erreur DB', async () => {
    prisma.notificationTemplate.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST / ============

describe('POST /api/admin/notification-templates', () => {
  const validPayload = {
    name: 'new-template',
    type: 'EMAIL',
    language: 'fr',
    title: 'Mon titre',
    body: 'Corps du template {{var}}',
    variables: ['var'],
  };

  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .post('/api/admin/notification-templates')
      .send(validPayload);
    expect(res.status).toBe(401);
  });

  test('403 — CLIENT ne peut pas créer', async () => {
    const res = await request(app)
      .post('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${clientToken()}`)
      .send(validPayload);
    expect(res.status).toBe(403);
  });

  test('400 — name manquant', async () => {
    const res = await request(app)
      .post('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ ...validPayload, name: undefined });
    expect(res.status).toBe(400);
  });

  test('400 — name trop court (< 3 chars)', async () => {
    const res = await request(app)
      .post('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ ...validPayload, name: 'ab' });
    expect(res.status).toBe(400);
  });

  test('400 — language invalide', async () => {
    const res = await request(app)
      .post('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ ...validPayload, language: 'pt' });
    expect(res.status).toBe(400);
  });

  test('400 — title manquant', async () => {
    const res = await request(app)
      .post('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ ...validPayload, title: undefined });
    expect(res.status).toBe(400);
  });

  test('400 — body manquant', async () => {
    const res = await request(app)
      .post('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ ...validPayload, body: undefined });
    expect(res.status).toBe(400);
  });

  test('201 — crée un nouveau template (première version)', async () => {
    prisma.notificationTemplate.findFirst.mockResolvedValue(null);
    prisma.notificationTemplate.updateMany.mockResolvedValue({ count: 0 });
    prisma.notificationTemplate.create.mockResolvedValue({ ...mockTemplate, name: 'new-template' });

    const res = await request(app)
      .post('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('template');
    expect(res.body.message).toMatch(/created successfully/i);
  });

  test('201 — crée une version 2 si un template du même nom existe', async () => {
    prisma.notificationTemplate.findFirst.mockResolvedValue({ ...mockTemplate, version: 1 });
    prisma.notificationTemplate.updateMany.mockResolvedValue({ count: 1 });
    prisma.notificationTemplate.create.mockResolvedValue({ ...mockTemplate, version: 2 });

    const res = await request(app)
      .post('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ ...validPayload, name: TEMPLATE_NAME });

    expect(res.status).toBe(201);
    expect(prisma.notificationTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 2 }),
      })
    );
  });

  test('500 — erreur DB lors du create', async () => {
    prisma.notificationTemplate.findFirst.mockResolvedValue(null);
    prisma.notificationTemplate.updateMany.mockResolvedValue({ count: 0 });
    prisma.notificationTemplate.create.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/api/admin/notification-templates')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send(validPayload);

    expect(res.status).toBe(500);
  });
});

// ============ PATCH /:id ============

describe('PATCH /api/admin/notification-templates/:id', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app)
      .patch(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .send({ title: 'Nouveau titre' });
    expect(res.status).toBe(401);
  });

  test('403 — CLIENT ne peut pas modifier', async () => {
    const res = await request(app)
      .patch(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${clientToken()}`)
      .send({ title: 'Nouveau titre' });
    expect(res.status).toBe(403);
  });

  test('404 — template introuvable', async () => {
    prisma.notificationTemplate.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/admin/notification-templates/inexistant')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ title: 'Titre mis à jour' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('200 — crée une nouvelle version avec le nouveau titre', async () => {
    prisma.notificationTemplate.findFirst.mockResolvedValue(mockTemplate);
    prisma.notificationTemplate.update.mockResolvedValue({ ...mockTemplate, isActive: false });
    prisma.notificationTemplate.create.mockResolvedValue(mockTemplateV2);

    const res = await request(app)
      .patch(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ title: 'Bienvenue sur MANAWA v2' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('template');
    expect(res.body.message).toMatch(/updated to/i);
    expect(res.body).toHaveProperty('previousVersion', 1);
  });

  test('400 — title trop long (> 200 chars)', async () => {
    const res = await request(app)
      .patch(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ title: 'a'.repeat(201) });
    expect(res.status).toBe(400);
  });

  test('500 — erreur DB lors du findFirst', async () => {
    prisma.notificationTemplate.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .patch(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ title: 'Titre' });

    expect(res.status).toBe(500);
  });
});

// ============ DELETE /:id ============

describe('DELETE /api/admin/notification-templates/:id', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).delete(`/api/admin/notification-templates/${TEMPLATE_NAME}`);
    expect(res.status).toBe(401);
  });

  test('403 — CLIENT ne peut pas supprimer', async () => {
    const res = await request(app)
      .delete(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  test('404 — template introuvable (count=0)', async () => {
    prisma.notificationTemplate.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app)
      .delete('/api/admin/notification-templates/inexistant')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('200 — désactive toutes les versions du template', async () => {
    prisma.notificationTemplate.updateMany.mockResolvedValue({ count: 2 });

    const res = await request(app)
      .delete(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('versionsAffected', 2);
    expect(res.body.message).toMatch(/disabled/i);
    expect(prisma.notificationTemplate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: TEMPLATE_NAME },
        data: { isActive: false },
      })
    );
  });

  test('500 — erreur DB', async () => {
    prisma.notificationTemplate.updateMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .delete(`/api/admin/notification-templates/${TEMPLATE_NAME}`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ GET /:id/versions ============

describe('GET /api/admin/notification-templates/:id/versions', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).get(`/api/admin/notification-templates/${TEMPLATE_NAME}/versions`);
    expect(res.status).toBe(401);
  });

  test('403 — CLIENT ne peut pas accéder', async () => {
    const res = await request(app)
      .get(`/api/admin/notification-templates/${TEMPLATE_NAME}/versions`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  test('404 — template introuvable (liste vide)', async () => {
    prisma.notificationTemplate.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/admin/notification-templates/inexistant/versions')
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('200 — retourne toutes les versions', async () => {
    prisma.notificationTemplate.findMany.mockResolvedValue([mockTemplateV2, mockTemplate]);

    const res = await request(app)
      .get(`/api/admin/notification-templates/${TEMPLATE_NAME}/versions`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', TEMPLATE_NAME);
    expect(res.body).toHaveProperty('versions');
    expect(res.body).toHaveProperty('total', 2);
  });

  test('500 — erreur DB', async () => {
    prisma.notificationTemplate.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get(`/api/admin/notification-templates/${TEMPLATE_NAME}/versions`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

// ============ POST /:id/revert/:version ============

describe('POST /api/admin/notification-templates/:id/revert/:version', () => {
  test('401 — sans token JWT', async () => {
    const res = await request(app).post(`/api/admin/notification-templates/${TEMPLATE_NAME}/revert/1`);
    expect(res.status).toBe(401);
  });

  test('403 — CLIENT ne peut pas revenir en arrière', async () => {
    const res = await request(app)
      .post(`/api/admin/notification-templates/${TEMPLATE_NAME}/revert/1`)
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });

  test('404 — version cible introuvable', async () => {
    prisma.notificationTemplate.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/admin/notification-templates/${TEMPLATE_NAME}/revert/99`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/version not found/i);
  });

  test('200 — revient à la version 1 et crée une v3', async () => {
    // findFirst appelé 2 fois : une pour trouver la version cible, une pour trouver la dernière
    prisma.notificationTemplate.findFirst
      .mockResolvedValueOnce(mockTemplate)       // version cible (v1)
      .mockResolvedValueOnce(mockTemplateV2);    // dernière version (v2) pour calculer v3

    prisma.notificationTemplate.updateMany.mockResolvedValue({ count: 2 });
    prisma.notificationTemplate.create.mockResolvedValue({
      ...mockTemplate,
      id: 'tpl-3',
      version: 3,
      isActive: true,
    });

    const res = await request(app)
      .post(`/api/admin/notification-templates/${TEMPLATE_NAME}/revert/1`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('template');
    expect(res.body.message).toMatch(/reverted/i);
    expect(prisma.notificationTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 3, isActive: true }),
      })
    );
  });

  test('400 — version param invalide (string)', async () => {
    const res = await request(app)
      .post(`/api/admin/notification-templates/${TEMPLATE_NAME}/revert/abc`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);
    expect(res.status).toBe(400);
  });

  test('500 — erreur DB', async () => {
    prisma.notificationTemplate.findFirst.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post(`/api/admin/notification-templates/${TEMPLATE_NAME}/revert/1`)
      .set('Authorization', `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(500);
  });
});

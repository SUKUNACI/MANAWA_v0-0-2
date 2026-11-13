/**
 * Tests for cdn-admin routes
 * Module: routes/cdn-admin.js — stats, resources, resource/:id, purge, delete, transformations, cache-config, cleanup, health
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { clientToken } = require('../helpers');

// cdn-admin.js uses requireRole('admin') with lowercase — custom token needed
function adminToken(id = 'admin-1') {
  return jwt.sign(
    { id, role: 'admin', email: 'admin@test.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
}

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

const mockCDNHelper = {
  getUsageStats: jest.fn(),
  listResources: jest.fn(),
  getImageMetadata: jest.fn(),
  deleteByTag: jest.fn(),
  deleteOldImages: jest.fn(),
};

jest.mock('../../utils/cdn-helpers', () => mockCDNHelper);

const mockCloudinary = {
  api: {
    delete_resources_by_prefix: jest.fn(),
    delete_all_resources: jest.fn(),
    resources: jest.fn(),
    ping: jest.fn(),
    account: jest.fn(),
  },
};

jest.mock('../../config/cdn', () => ({
  cloudinary: mockCloudinary,
  FOLDERS: { avatars: 'manawa/avatars' },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../utils/sorting-helper', () => ({
  buildPaginationQuery: jest.fn(() => ({ skip: 0, take: 20 })),
}));

jest.mock('../../config/sortable-fields', () => ({
  getSortableFields: jest.fn(() => []),
}));

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/admin/cdn', require('../../routes/cdn-admin'));
});

// ─── Auth & Role guards ───────────────────────────────────────────────────────

describe('Auth & Role guards', () => {
  it('GET /stats — 401 sans token', async () => {
    const res = await request(app).get('/admin/cdn/stats');
    expect(res.status).toBe(401);
  });

  it('GET /stats — 403 avec token client', async () => {
    const res = await request(app)
      .get('/admin/cdn/stats')
      .set('Authorization', `Bearer ${clientToken()}`);
    expect(res.status).toBe(403);
  });
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

describe('GET /stats', () => {
  it('200 avec stats CDN', async () => {
    mockCDNHelper.getUsageStats.mockResolvedValue({
      bandwidth: { used_gb: 50 },
      storage: { used_gb: 10 },
      transformations: 500000,
    });

    const res = await request(app)
      .get('/admin/cdn/stats')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('usage');
    expect(res.body.data).toHaveProperty('costs');
    expect(res.body.data).toHaveProperty('recommendations');
  });

  it('500 si getUsageStats échoue', async () => {
    mockCDNHelper.getUsageStats.mockRejectedValue(new Error('CDN error'));

    const res = await request(app)
      .get('/admin/cdn/stats')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /resources ───────────────────────────────────────────────────────────

describe('GET /resources', () => {
  it('400 sans paramètre folder', async () => {
    const res = await request(app)
      .get('/admin/cdn/resources')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('200 avec folder valide', async () => {
    mockCDNHelper.listResources.mockResolvedValue({
      resources: [{ public_id: 'manawa/avatars/img1', url: 'https://cdn.example.com/img1' }],
      next_cursor: null,
    });

    const res = await request(app)
      .get('/admin/cdn/resources?folder=manawa/avatars')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('500 si listResources échoue', async () => {
    mockCDNHelper.listResources.mockRejectedValue(new Error('CDN error'));

    const res = await request(app)
      .get('/admin/cdn/resources?folder=manawa/avatars')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });
});

// ─── GET /resource/:publicId ──────────────────────────────────────────────────

describe('GET /resource/:publicId', () => {
  it('200 avec métadonnées de ressource', async () => {
    mockCDNHelper.getImageMetadata.mockResolvedValue({
      public_id: 'manawa/avatars/img1',
      format: 'jpg',
      width: 200,
      height: 200,
    });

    const res = await request(app)
      .get('/admin/cdn/resource/manawa%2Favatars%2Fimg1')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('500 si getImageMetadata échoue', async () => {
    mockCDNHelper.getImageMetadata.mockRejectedValue(new Error('Not found'));

    const res = await request(app)
      .get('/admin/cdn/resource/invalid-id')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });
});

// ─── POST /purge ──────────────────────────────────────────────────────────────

describe('POST /purge', () => {
  it('400 sans méthode', async () => {
    const res = await request(app)
      .post('/admin/cdn/purge')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('400 méthode url sans url', async () => {
    const res = await request(app)
      .post('/admin/cdn/purge')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ method: 'url' });

    expect(res.status).toBe(400);
  });

  it('200 méthode url avec url', async () => {
    mockCloudinary.api.delete_resources_by_prefix.mockResolvedValue({ deleted: {} });

    const res = await request(app)
      .post('/admin/cdn/purge')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ method: 'url', url: 'manawa/avatars/' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('400 méthode folder sans folder', async () => {
    const res = await request(app)
      .post('/admin/cdn/purge')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ method: 'folder' });

    expect(res.status).toBe(400);
  });

  it('200 méthode folder avec folder', async () => {
    mockCloudinary.api.delete_resources_by_prefix.mockResolvedValue({ deleted: {} });

    const res = await request(app)
      .post('/admin/cdn/purge')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ method: 'folder', folder: 'manawa/avatars' });

    expect(res.status).toBe(200);
  });

  it('400 méthode tag sans tag', async () => {
    const res = await request(app)
      .post('/admin/cdn/purge')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ method: 'tag' });

    expect(res.status).toBe(400);
  });

  it('200 méthode tag avec tag', async () => {
    mockCDNHelper.deleteByTag.mockResolvedValue({ deleted: 5 });

    const res = await request(app)
      .post('/admin/cdn/purge')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ method: 'tag', tag: 'avatar' });

    expect(res.status).toBe(200);
  });

  it('403 méthode all hors development', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const res = await request(app)
      .post('/admin/cdn/purge')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ method: 'all' });

    process.env.NODE_ENV = original;
    expect(res.status).toBe(403);
  });

  it('200 méthode all en development', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    mockCloudinary.api.delete_all_resources.mockResolvedValue({ deleted: 'all' });

    const res = await request(app)
      .post('/admin/cdn/purge')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ method: 'all' });

    process.env.NODE_ENV = original;
    expect(res.status).toBe(200);
  });

  it('400 méthode invalide', async () => {
    const res = await request(app)
      .post('/admin/cdn/purge')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ method: 'unknown' });

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /resources ────────────────────────────────────────────────────────

describe('DELETE /resources', () => {
  it('400 sans publicIds', async () => {
    const res = await request(app)
      .delete('/admin/cdn/resources')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('400 tableau vide', async () => {
    const res = await request(app)
      .delete('/admin/cdn/resources')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ publicIds: [] });

    expect(res.status).toBe(400);
  });

  it('400 plus de 500 éléments', async () => {
    const publicIds = Array.from({ length: 501 }, (_, i) => `id-${i}`);

    const res = await request(app)
      .delete('/admin/cdn/resources')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ publicIds });

    expect(res.status).toBe(400);
  });

  it('200 suppression réussie', async () => {
    mockCDNHelper.deleteOldImages.mockResolvedValue({ deleted: 2 });

    const res = await request(app)
      .delete('/admin/cdn/resources')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ publicIds: ['id-1', 'id-2'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('500 si deleteOldImages échoue', async () => {
    mockCDNHelper.deleteOldImages.mockRejectedValue(new Error('Delete failed'));

    const res = await request(app)
      .delete('/admin/cdn/resources')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ publicIds: ['id-1'] });

    expect(res.status).toBe(500);
  });
});

// ─── GET /transformations ─────────────────────────────────────────────────────

describe('GET /transformations', () => {
  it('200 retourne la liste des transformations', async () => {
    const res = await request(app)
      .get('/admin/cdn/transformations')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.transformations)).toBe(true);
    expect(res.body.data.transformations.length).toBeGreaterThan(0);
  });
});

// ─── GET /cache-config ────────────────────────────────────────────────────────

describe('GET /cache-config', () => {
  it('200 retourne la config du cache', async () => {
    const res = await request(app)
      .get('/admin/cdn/cache-config')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('browser');
    expect(res.body.data).toHaveProperty('cdn');
  });
});

// ─── POST /cleanup ────────────────────────────────────────────────────────────

describe('POST /cleanup', () => {
  it('200 aucune ressource à nettoyer', async () => {
    mockCloudinary.api.resources.mockResolvedValue({ resources: [] });

    const res = await request(app)
      .post('/admin/cdn/cleanup')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.cleaned).toBe(0);
  });

  it('200 ressources supprimées', async () => {
    const oldDate = new Date('2020-01-01').toISOString();
    mockCloudinary.api.resources.mockResolvedValue({
      resources: [
        { public_id: 'old-1', created_at: oldDate },
        { public_id: 'old-2', created_at: oldDate },
      ],
    });
    mockCDNHelper.deleteOldImages.mockResolvedValue({ deleted: 2 });

    const res = await request(app)
      .post('/admin/cdn/cleanup')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.cleaned).toBe(2);
  });

  it('500 si cloudinary.api.resources échoue', async () => {
    mockCloudinary.api.resources.mockRejectedValue(new Error('API error'));

    const res = await request(app)
      .post('/admin/cdn/cleanup')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(500);
  });
});

// ─── GET /health ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('200 CDN connecté', async () => {
    mockCloudinary.api.ping.mockResolvedValue({ status: 'ok' });
    mockCloudinary.api.account.mockResolvedValue({
      cloud_name: 'test-cloud',
      plan: 'free',
    });

    const res = await request(app)
      .get('/admin/cdn/health')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.cloudinary.connected).toBe(true);
  });

  it('503 si ping échoue', async () => {
    mockCloudinary.api.ping.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app)
      .get('/admin/cdn/health')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });
});

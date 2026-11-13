'use strict';

/**
 * Tests pour utils/dbBackup.js
 * Création de branches de backup Neon et nettoyage des branches obsolètes
 */

// Mock axios.create pour retourner notre API mockée
// dbBackup appelle axios.create() au moment de neonApi(), pas au chargement du module
jest.mock('axios');
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const axios = require('axios');
const logger = require('../../utils/logger');

// Instance axios mockée (axios.create retourne un objet avec get/post/delete)
const mockApi = {
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
};

// dbBackup.js charge BACKUP_RETENTION_DAYS à la lecture du module (parseInt au top-level).
// On le charge UNE SEULE FOIS avec la valeur env par défaut.
// Pour tester différentes valeurs de retention, on reconfigure l'env avant le premier require.
process.env.BACKUP_RETENTION_DAYS = '7';
const { createDailyBackupBranch } = require('../../utils/dbBackup');

beforeEach(() => {
  jest.clearAllMocks();
  // axios.create doit retourner notre mock API à chaque appel de neonApi()
  axios.create.mockReturnValue(mockApi);

  delete process.env.NEON_API_KEY;
  delete process.env.NEON_PROJECT_ID;
});

// ─── Pas de credentials ───────────────────────────────────────────────────────

describe('createDailyBackupBranch — sans credentials', () => {
  it('log un warning et retourne si NEON_API_KEY manquant', async () => {
    process.env.NEON_PROJECT_ID = 'proj-123';

    await createDailyBackupBranch();

    expect(logger.warn).toHaveBeenCalledWith(
      '[Backup] NEON_API_KEY ou NEON_PROJECT_ID manquant — backup ignoré'
    );
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('log un warning et retourne si NEON_PROJECT_ID manquant', async () => {
    process.env.NEON_API_KEY = 'neon-key-123';

    await createDailyBackupBranch();

    expect(logger.warn).toHaveBeenCalledWith(
      '[Backup] NEON_API_KEY ou NEON_PROJECT_ID manquant — backup ignoré'
    );
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('log un warning si les deux manquent', async () => {
    await createDailyBackupBranch();

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

// ─── Création de branche réussie ──────────────────────────────────────────────

describe('createDailyBackupBranch — succès', () => {
  beforeEach(() => {
    process.env.NEON_API_KEY = 'neon-api-key';
    process.env.NEON_PROJECT_ID = 'proj-abc';
  });

  it('crée une branche avec le nom backup-YYYY-MM-DD', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const branchName = `backup-${today}`;

    mockApi.post.mockResolvedValue({
      data: { branch: { name: branchName, id: 'branch-id-123' } },
    });
    mockApi.get.mockResolvedValue({ data: { branches: [] } });

    await createDailyBackupBranch();

    expect(mockApi.post).toHaveBeenCalledWith(
      '/projects/proj-abc/branches',
      { branch: { name: branchName } }
    );
  });

  it('log un message de succès avec le nom et l\'id de la branche', async () => {
    const today = new Date().toISOString().slice(0, 10);

    mockApi.post.mockResolvedValue({
      data: { branch: { name: `backup-${today}`, id: 'br-id-xyz' } },
    });
    mockApi.get.mockResolvedValue({ data: { branches: [] } });

    await createDailyBackupBranch();

    expect(logger.info).toHaveBeenCalledWith(
      '[Backup] ✅ Branche créée',
      expect.objectContaining({ name: `backup-${today}`, id: 'br-id-xyz' })
    );
  });

  it('appelle pruneOldBackupBranches après la création (GET /branches)', async () => {
    const today = new Date().toISOString().slice(0, 10);

    mockApi.post.mockResolvedValue({
      data: { branch: { name: `backup-${today}`, id: 'br-123' } },
    });
    mockApi.get.mockResolvedValue({ data: { branches: [] } });

    await createDailyBackupBranch();

    expect(mockApi.get).toHaveBeenCalledWith('/projects/proj-abc/branches');
  });

  it('résout sans erreur', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockApi.post.mockResolvedValue({
      data: { branch: { name: `backup-${today}`, id: 'br-ok' } },
    });
    mockApi.get.mockResolvedValue({ data: { branches: [] } });

    await expect(createDailyBackupBranch()).resolves.toBeUndefined();
  });
});

// ─── Branche déjà existante (409) ────────────────────────────────────────────

describe('createDailyBackupBranch — 409 déjà existante', () => {
  beforeEach(() => {
    process.env.NEON_API_KEY = 'key';
    process.env.NEON_PROJECT_ID = 'proj-abc';
  });

  it('log info (idempotent) et continue si status 409', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const conflictError = new Error('Conflict');
    conflictError.response = { status: 409 };

    mockApi.post.mockRejectedValue(conflictError);
    mockApi.get.mockResolvedValue({ data: { branches: [] } });

    await createDailyBackupBranch();

    expect(logger.info).toHaveBeenCalledWith(
      `[Backup] Branche backup-${today} déjà existante`
    );
    // Doit quand même pruner
    expect(mockApi.get).toHaveBeenCalled();
  });
});

// ─── Erreur inattendue lors de la création ────────────────────────────────────

describe('createDailyBackupBranch — erreur création', () => {
  beforeEach(() => {
    process.env.NEON_API_KEY = 'key';
    process.env.NEON_PROJECT_ID = 'proj-abc';
  });

  it('log error et retourne sans pruner si création échoue (non-409)', async () => {
    const serverError = new Error('Internal Error');
    serverError.response = {
      status: 500,
      data: { message: 'DB overloaded' },
    };

    mockApi.post.mockRejectedValue(serverError);

    await createDailyBackupBranch();

    expect(logger.error).toHaveBeenCalledWith(
      '[Backup] ❌ Échec création branche',
      expect.objectContaining({ error: 'DB overloaded' })
    );
    // Pas de pruning après une erreur fatale
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('utilise err.message si pas de response.data.message', async () => {
    // Erreur sans response (réseau) → err.response est undefined
    const networkError = new Error('Network timeout');
    // Pas de networkError.response

    mockApi.post.mockRejectedValue(networkError);

    await createDailyBackupBranch();

    expect(logger.error).toHaveBeenCalledWith(
      '[Backup] ❌ Échec création branche',
      expect.objectContaining({ error: 'Network timeout' })
    );
  });
});

// ─── Pruning des vieilles branches ───────────────────────────────────────────

describe('pruneOldBackupBranches', () => {
  beforeEach(() => {
    process.env.NEON_API_KEY = 'key';
    process.env.NEON_PROJECT_ID = 'proj-abc';
  });

  it('supprime les branches stale (nom backup-* ET date < cutoff)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Date vieille de 8 jours → stale avec retention 7 jours
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date().toISOString();

    mockApi.post.mockResolvedValue({
      data: { branch: { name: `backup-${today}`, id: 'br-new' } },
    });
    mockApi.get.mockResolvedValue({
      data: {
        branches: [
          { id: 'br-stale',  name: 'backup-2020-01-01', created_at: staleDate },
          { id: 'br-recent', name: `backup-${today}`,   created_at: recentDate },
          { id: 'br-main',   name: 'main',              created_at: staleDate },
        ],
      },
    });
    mockApi.delete.mockResolvedValue({});

    await createDailyBackupBranch();

    expect(mockApi.delete).toHaveBeenCalledWith('/projects/proj-abc/branches/br-stale');
    expect(mockApi.delete).not.toHaveBeenCalledWith('/projects/proj-abc/branches/br-recent');
    expect(mockApi.delete).not.toHaveBeenCalledWith('/projects/proj-abc/branches/br-main');
  });

  it('ne supprime rien si toutes les branches sont récentes', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const recentDate = new Date().toISOString();

    mockApi.post.mockResolvedValue({
      data: { branch: { name: `backup-${today}`, id: 'br-new' } },
    });
    mockApi.get.mockResolvedValue({
      data: {
        branches: [
          { id: 'br-fresh', name: `backup-${today}`, created_at: recentDate },
        ],
      },
    });

    await createDailyBackupBranch();

    expect(mockApi.delete).not.toHaveBeenCalled();
  });

  it('log un warning si le pruning échoue (sans propager)', async () => {
    const today = new Date().toISOString().slice(0, 10);

    mockApi.post.mockResolvedValue({
      data: { branch: { name: `backup-${today}`, id: 'br-new' } },
    });
    mockApi.get.mockRejectedValue(new Error('Get branches failed'));

    await expect(createDailyBackupBranch()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      '[Backup] Nettoyage branches',
      expect.objectContaining({ error: 'Get branches failed' })
    );
  });

  it('fonctionne si data.branches est undefined (array vide par défaut)', async () => {
    const today = new Date().toISOString().slice(0, 10);

    mockApi.post.mockResolvedValue({
      data: { branch: { name: `backup-${today}`, id: 'br-new' } },
    });
    mockApi.get.mockResolvedValue({ data: {} }); // branches absent

    await expect(createDailyBackupBranch()).resolves.toBeUndefined();

    expect(mockApi.delete).not.toHaveBeenCalled();
  });

  it('log info pour chaque branche supprimée', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    mockApi.post.mockResolvedValue({
      data: { branch: { name: `backup-${today}`, id: 'br-new' } },
    });
    mockApi.get.mockResolvedValue({
      data: {
        branches: [
          { id: 'br-s1', name: 'backup-2020-01-01', created_at: staleDate },
        ],
      },
    });
    mockApi.delete.mockResolvedValue({});

    await createDailyBackupBranch();

    expect(logger.info).toHaveBeenCalledWith(
      '[Backup] Branche supprimée',
      expect.objectContaining({ name: 'backup-2020-01-01' })
    );
  });
});

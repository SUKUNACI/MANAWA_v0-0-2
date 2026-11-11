const axios = require('axios');

const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10);

function neonApi() {
  return axios.create({
    baseURL: 'https://console.neon.tech/api/v2',
    headers: {
      Authorization: `Bearer ${process.env.NEON_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

async function pruneOldBackupBranches(api, projectId) {
  try {
    const logger = require('./logger');
    const { data } = await api.get(`/projects/${projectId}/branches`);
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const stale = (data.branches || []).filter(
      (b) => b.name.startsWith('backup-') && new Date(b.created_at).getTime() < cutoff
    );
    for (const b of stale) {
      await api.delete(`/projects/${projectId}/branches/${b.id}`);
      logger.info('[Backup] Branche supprimée', { name: b.name });
    }
  } catch (err) {
    const logger = require('./logger');
    logger.warn('[Backup] Nettoyage branches', { error: err.response?.data?.message || err.message });
  }
}

// ERROR #19: Log backup failures
async function createDailyBackupBranch() {
  const logger = require('./logger');
  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;

  if (!apiKey || !projectId) {
    logger.warn('[Backup] NEON_API_KEY ou NEON_PROJECT_ID manquant — backup ignoré');
    return;
  }

  const api = neonApi();
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const branchName = `backup-${date}`;

  try {
    const { data } = await api.post(`/projects/${projectId}/branches`, {
      branch: { name: branchName },
    });
    logger.info('[Backup] ✅ Branche créée', { name: data.branch.name, id: data.branch.id });
  } catch (err) {
    if (err.response?.status === 409) {
      // Branche du jour déjà existante — idempotent, pas d'erreur
      logger.info(`[Backup] Branche ${branchName} déjà existante`);
    } else {
      logger.error('[Backup] ❌ Échec création branche', { error: err.response?.data?.message || err.message });
      return;
    }
  }

  await pruneOldBackupBranches(api, projectId);
}

module.exports = { createDailyBackupBranch };

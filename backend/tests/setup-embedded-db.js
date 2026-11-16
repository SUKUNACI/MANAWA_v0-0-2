const path = require('path');
const os = require('os');
const fs = require('fs');

let pgInstance = null;

async function setupDatabase() {
  try {
    const EmbeddedPostgres = require('embedded-postgres').EmbeddedPostgres;
    const dataDir = path.join(os.tmpdir(), 'pg-test-' + Date.now());
    fs.mkdirSync(dataDir, { recursive: true });

    pgInstance = new EmbeddedPostgres({
      dataDirectory: dataDir,
      port: 5432,
      user: 'user',
      password: 'password',
      database: 'manawa_test',
    });

    await pgInstance.start();
    console.log('[TEST] PostgreSQL embarqué lancé');
    return pgInstance;
  } catch (err) {
    console.error('[TEST] Erreur PostgreSQL:', err.message);
    throw err;
  }
}

async function teardownDatabase() {
  if (pgInstance) {
    try {
      await pgInstance.stop();
      console.log('[TEST] PostgreSQL arrêté');
    } catch (err) {
      console.error('[TEST] Erreur arrêt:', err.message);
    }
  }
}

module.exports = { setupDatabase, teardownDatabase };

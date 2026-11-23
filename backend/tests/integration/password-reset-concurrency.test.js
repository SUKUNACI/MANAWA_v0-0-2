'use strict';

/**
 * T1.03 — Test d'intégration : atomicité réelle PostgreSQL pour completePasswordReset()
 *
 * Ce test exerce directement AdminModule.completePasswordReset() avec un vrai client
 * Prisma connecté à une base PostgreSQL locale — aucun mock ne remplace le moteur SQL.
 *
 * Stratégie de concurrence :
 *   Les deux appels sont déclenchés avec Promise.all() sans aucun délai artificiel.
 *   Le test vérifie l'état final en base (non le résultat des promesses) pour prouver
 *   qu'une seule mise à jour a été appliquée.
 *
 * Prérequis locaux (CI et dev) :
 *   Une variable d'environnement INTEGRATION_PG_URL doit pointer sur une base PostgreSQL
 *   réelle avec le schéma User + RefreshToken. Si absent, le test échoue explicitement.
 *
 * Prérequis CI (ci.yml) :
 *   Le job "concurrency-integration" utilise services: postgres:15.
 *   DATABASE_URL est passé via env, INTEGRATION_PG_URL est identique dans ce contexte.
 *
 * Ce fichier est exclu du CI standard via jest.config.js (testPathIgnorePatterns: ['integration/']).
 * Il est exécuté par le job dédié "concurrency-integration" dans ci.yml.
 */

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const INTEGRATION_PG_URL = process.env.INTEGRATION_PG_URL;

// Échec explicite si aucune base PostgreSQL réelle n'est disponible.
// Aucun retour silencieux, aucun test fantôme, aucun skip.
if (!INTEGRATION_PG_URL) {
  throw new Error(
    '[T1.03 intégration] INTEGRATION_PG_URL non définie.\n' +
    'Définissez cette variable avec une URL PostgreSQL réelle avant de lancer ce test.\n' +
    'Exemple : INTEGRATION_PG_URL=postgresql://postgres@localhost:54320/manawa_concurrency_test npx jest --config=\'{"testEnvironment":"node","clearMocks":true,"testTimeout":60000}\' tests/integration/password-reset-concurrency.test.js --no-coverage\n' +
    'Ce test ne peut pas s\'exécuter sans un vrai PostgreSQL.'
  );
}

const AdminModule = require('../../modules/admin');

// Appende connection_limit=1 à l'URL pour forcer un pool d'une seule connexion.
// Utilisé par les clients dédiés au test de concurrence.
function pgUrlSingleConn(url) {
  return url + (url.includes('?') ? '&' : '?') + 'connection_limit=1';
}

// prisma        — client partagé (setup, teardown, assertions de lecture)
// prismaA       — connexion dédiée A (connection_limit=1) pour le test de concurrence
// prismaB       — connexion dédiée B (connection_limit=1) pour le test de concurrence
//
// En imposant connection_limit=1 sur prismaA et prismaB, chacun détient exactement
// une connexion PostgreSQL indépendante. Les deux appels concurrents transitent ainsi
// par des connexions distinctes à niveau du serveur PostgreSQL — ce qui est la condition
// nécessaire pour prouver que le verrou implicite du WHERE conditionnel fonctionne en
// présence de vraies requêtes parallèles et non de requêtes sérialisées par un pool.
let prisma;
let prismaA;
let prismaB;
let adminModule;
let adminModuleA;
let adminModuleB;

beforeAll(async () => {
  const singleConnUrl = pgUrlSingleConn(INTEGRATION_PG_URL);

  prisma  = new PrismaClient({ datasources: { db: { url: INTEGRATION_PG_URL } }, log: [] });
  prismaA = new PrismaClient({ datasources: { db: { url: singleConnUrl } }, log: [] });
  prismaB = new PrismaClient({ datasources: { db: { url: singleConnUrl } }, log: [] });

  await Promise.all([prisma.$connect(), prismaA.$connect(), prismaB.$connect()]);

  adminModule  = new AdminModule(prisma);
  adminModuleA = new AdminModule(prismaA);
  adminModuleB = new AdminModule(prismaB);
}, 20000);

afterAll(async () => {
  await Promise.allSettled([
    prisma?.$disconnect(),
    prismaA?.$disconnect(),
    prismaB?.$disconnect(),
  ]);
}, 15000);

beforeEach(async () => {
  // Nettoyage garanti même en cas d'échec d'un test précédent
  // deleteMany sur refreshToken d'abord (FK vers User)
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(async () => {
  // Double nettoyage pour éviter toute pollution entre tests
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createTestUser(overrides = {}) {
  const passwordHash = await bcrypt.hash('OldPassword123!', 10);
  const rawToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiry = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h

  // Utilise l'ORM Prisma pour respecter tous les champs NOT NULL et les defaults
  const user = await prisma.user.create({
    data: {
      email: 'test-' + crypto.randomUUID() + '@integration.test',
      passwordHash,
      firstName: 'Test',
      lastName: 'User',
      role: 'CLIENT',
      mustChangePassword: true,
      passwordResetCode: tokenHash,
      passwordResetExpiry: expiry,
    },
  });

  // Crée deux refresh tokens pour vérifier leur suppression après reset
  const rtExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.createMany({
    data: [
      { token: crypto.randomBytes(32).toString('hex'), userId: user.id, expiresAt: rtExpiry },
      { token: crypto.randomBytes(32).toString('hex'), userId: user.id, expiresAt: rtExpiry },
    ],
  });

  return { id: user.id, rawToken, tokenHash, passwordHash, ...overrides };
}

async function getUserState(userId) {
  const rows = await prisma.$queryRaw`
    SELECT "passwordHash", "passwordResetCode", "mustChangePassword"
    FROM "User" WHERE id = ${userId}
  `;
  return rows[0] || null;
}

async function getRefreshTokenCount(userId) {
  const rows = await prisma.$queryRaw`
    SELECT count(*)::int AS cnt FROM "RefreshToken" WHERE "userId" = ${userId}
  `;
  return rows[0].cnt;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('completePasswordReset() — atomicité PostgreSQL réelle (T1.03)', () => {

  test('deux requêtes concurrentes avec le même jeton : une seule réussit', async () => {
    const { id: userId, rawToken } = await createTestUser();

    // Les deux appels utilisent des connexions PostgreSQL indépendantes (connection_limit=1
    // sur prismaA et prismaB). Chacun détient une connexion distincte côté serveur PG.
    // AdminModule.completePasswordReset() ouvre une $transaction([$queryRaw, deleteMany]).
    // Le WHERE conditionnel sur passwordResetCode et passwordResetExpiry garantit qu'un
    // seul UPDATE retourne des lignes — l'autre transaction trouve 0 lignes et lève
    // RESET_TOKEN_INVALID. Les deux appels sont soumis sans délai artificiel.
    const [r1, r2] = await Promise.allSettled([
      adminModuleA.completePasswordReset(userId, rawToken, 'NewPassword1!'),
      adminModuleB.completePasswordReset(userId, rawToken, 'NewPassword2!'),
    ]);

    const successes = [r1, r2].filter((r) => r.status === 'fulfilled');
    const failures  = [r1, r2].filter((r) => r.status === 'rejected');

    // Exactement une réussite, exactement un rejet
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // L'échec doit être RESET_TOKEN_INVALID (jeton consommé par la première transaction)
    expect(failures[0].reason.code).toBe('RESET_TOKEN_INVALID');

    // Vérification directe dans PostgreSQL — état post-transaction
    const state = await getUserState(userId);

    // Le jeton est consommé (NULL)
    expect(state.passwordResetCode).toBeNull();

    // mustChangePassword est levé
    expect(state.mustChangePassword).toBe(false);

    // Le passwordHash correspond exactement au mot de passe de la transaction gagnante
    const winnerPassword = r1.status === 'fulfilled' ? 'NewPassword1!' : 'NewPassword2!';
    const passwordMatches = await bcrypt.compare(winnerPassword, state.passwordHash);
    expect(passwordMatches).toBe(true);

    // Le mot de passe perdant ne correspond pas au hash final
    const loserPassword = r1.status === 'fulfilled' ? 'NewPassword2!' : 'NewPassword1!';
    const loserMatches = await bcrypt.compare(loserPassword, state.passwordHash);
    expect(loserMatches).toBe(false);

    // Les refresh tokens sont tous supprimés (invalidation de session)
    const rtCount = await getRefreshTokenCount(userId);
    expect(rtCount).toBe(0);
  }, 30000);

  test('le jeton déjà consommé rejette toute tentative ultérieure', async () => {
    const { id: userId, rawToken } = await createTestUser();

    // Première utilisation — doit réussir
    await adminModule.completePasswordReset(userId, rawToken, 'NewPassword1!');

    // Deuxième utilisation du même jeton — doit échouer
    await expect(
      adminModule.completePasswordReset(userId, rawToken, 'AnotherPassword1!')
    ).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' });

    // Le mot de passe n'a pas changé après la deuxième tentative
    const state = await getUserState(userId);
    const stillFirstPassword = await bcrypt.compare('NewPassword1!', state.passwordHash);
    expect(stillFirstPassword).toBe(true);
  }, 20000);

  test('un jeton expiré est rejeté même si le hash correspond', async () => {
    const passwordHash = await bcrypt.hash('OldPassword123!', 10);
    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    // Expiry dans le passé
    const expiredExpiry = new Date(Date.now() - 1000);

    const user = await prisma.user.create({
      data: {
        email: 'expired-' + crypto.randomUUID() + '@integration.test',
        passwordHash,
        firstName: 'Expired',
        lastName: 'User',
        role: 'CLIENT',
        mustChangePassword: true,
        passwordResetCode: tokenHash,
        passwordResetExpiry: expiredExpiry,
      },
    });

    await expect(
      adminModule.completePasswordReset(user.id, rawToken, 'NewPassword1!')
    ).rejects.toMatchObject({ code: 'RESET_TOKEN_EXPIRED' });

    // La base est inchangée
    const state = await getUserState(user.id);
    expect(state.passwordResetCode).toBe(tokenHash);
    expect(state.mustChangePassword).toBe(true);
  }, 15000);

  test('un token invalide (mauvais hash) est rejeté', async () => {
    const { id: userId } = await createTestUser();
    const wrongToken = crypto.randomBytes(48).toString('hex'); // différent du token stocké

    await expect(
      adminModule.completePasswordReset(userId, wrongToken, 'NewPassword1!')
    ).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' });

    const state = await getUserState(userId);
    expect(state.mustChangePassword).toBe(true);
    expect(state.passwordResetCode).not.toBeNull();
  }, 15000);

  test('le même mot de passe que l\'ancien est rejeté', async () => {
    const { id: userId, rawToken } = await createTestUser();

    await expect(
      adminModule.completePasswordReset(userId, rawToken, 'OldPassword123!')
    ).rejects.toMatchObject({ status: 400 });

    // Pas de modification en base
    const state = await getUserState(userId);
    expect(state.mustChangePassword).toBe(true);
    expect(state.passwordResetCode).not.toBeNull();
  }, 15000);

  test('état de la base cohérent après reset réussi : 0 token, mustChangePassword false, hash mis à jour', async () => {
    const { id: userId, rawToken, passwordHash: oldHash } = await createTestUser();

    const result = await adminModule.completePasswordReset(userId, rawToken, 'FreshPassword9!');
    expect(result).toEqual({ reset: true });

    const state = await getUserState(userId);
    expect(state.passwordResetCode).toBeNull();
    expect(state.mustChangePassword).toBe(false);

    // Le hash a changé
    expect(state.passwordHash).not.toBe(oldHash);
    // Le nouveau hash correspond bien au nouveau mot de passe
    const valid = await bcrypt.compare('FreshPassword9!', state.passwordHash);
    expect(valid).toBe(true);

    // Toutes les sessions révoquées
    const rtCount = await getRefreshTokenCount(userId);
    expect(rtCount).toBe(0);
  }, 20000);
});

'use strict';

/**
 * Tests pour utils/geniuspay-test.js
 * Script utilitaire de test de l'intégration GeniusPay (run-script, pas de routes HTTP)
 */

// ── Mock geniuspay avant tout require ────────────────────────────────────────
jest.mock('../../utils/geniuspay', () => ({
  getAccountInfo: jest.fn(),
  getAccountBalance: jest.fn(),
  getPawapayProviders: jest.fn(),
  createPayment: jest.fn(),
  getPayment: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  verifyWebhookTimestamp: jest.fn(),
}));

// Mock crypto (utilisé dans le script pour calculer la signature de test)
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    createHmac: jest.fn().mockImplementation(() => ({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('mock-signature-hex'),
    })),
  };
});

const geniuspay = require('../../utils/geniuspay');
const { testGeniusPay } = require('../../utils/geniuspay-test');

// Spy sur console.log et console.error pour ne pas polluer les sorties de test
let consoleSpy;
let consoleErrorSpy;

beforeEach(() => {
  jest.clearAllMocks();
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  // Réinitialiser GENIUSPAY_WEBHOOK_SECRET
  process.env.GENIUSPAY_WEBHOOK_SECRET = 'test-webhook-secret';
});

afterEach(() => {
  consoleSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

// ─── Exports ──────────────────────────────────────────────────────────────────

describe('exports', () => {
  it('exporte la fonction testGeniusPay', () => {
    expect(typeof testGeniusPay).toBe('function');
  });
});

// ─── testGeniusPay — flux complet (happy path) ───────────────────────────────

describe('testGeniusPay — flux complet', () => {
  beforeEach(() => {
    geniuspay.getAccountInfo.mockResolvedValue({
      success: true,
      data: {
        business_name: 'MANAWA CI',
        status: 'active',
        environment: 'sandbox',
      },
    });

    geniuspay.getAccountBalance.mockResolvedValue({
      success: true,
      data: {
        available: 500000,
        pending: 50000,
        total: 550000,
      },
    });

    geniuspay.getPawapayProviders.mockResolvedValue({
      success: true,
      data: {
        country_name: 'Côte d\'Ivoire',
        currency: 'XOF',
        providers: [
          { name: 'MTN CI', code: 'MTN_CI' },
          { name: 'Orange CI', code: 'ORANGE_CI' },
        ],
      },
    });

    geniuspay.createPayment.mockResolvedValue({
      success: true,
      data: {
        reference: 'REF-MANAWA-001',
        amount: 15000,
        checkout_url: 'https://geniuspay.ci/pay/REF-001',
        expires_at: '2026-11-14T10:00:00Z',
      },
    });

    geniuspay.getPayment.mockResolvedValue({
      success: true,
      data: {
        status: 'PENDING',
        fees: 450,
        net_amount: 14550,
      },
    });

    geniuspay.verifyWebhookSignature.mockReturnValue(true);
    geniuspay.verifyWebhookTimestamp.mockReturnValue(true);
  });

  it('exécute sans erreur dans le cas nominal', async () => {
    await expect(testGeniusPay()).resolves.toBeUndefined();
  });

  it('appelle getAccountInfo', async () => {
    await testGeniusPay();
    expect(geniuspay.getAccountInfo).toHaveBeenCalled();
  });

  it('appelle getAccountBalance', async () => {
    await testGeniusPay();
    expect(geniuspay.getAccountBalance).toHaveBeenCalled();
  });

  it('appelle getPawapayProviders avec "CI"', async () => {
    await testGeniusPay();
    expect(geniuspay.getPawapayProviders).toHaveBeenCalledWith('CI');
  });

  it('appelle createPayment avec amount=15000', async () => {
    await testGeniusPay();
    const callArg = geniuspay.createPayment.mock.calls[0][0];
    expect(callArg.amount).toBe(15000);
  });

  it('appelle getPayment avec la référence retournée', async () => {
    await testGeniusPay();
    expect(geniuspay.getPayment).toHaveBeenCalledWith('REF-MANAWA-001');
  });

  it('appelle verifyWebhookSignature et verifyWebhookTimestamp', async () => {
    await testGeniusPay();
    expect(geniuspay.verifyWebhookSignature).toHaveBeenCalled();
    expect(geniuspay.verifyWebhookTimestamp).toHaveBeenCalled();
  });
});

// ─── testGeniusPay — échec getAccountInfo ────────────────────────────────────

describe('testGeniusPay — getAccountInfo échoue', () => {
  it('lève une erreur si getAccountInfo retourne success=false', async () => {
    geniuspay.getAccountInfo.mockResolvedValue({
      success: false,
      error: { message: 'API key invalid' },
    });

    // Le script appelle process.exit(1) — on le mock pour ne pas quitter le process
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit(1)');
    });

    await expect(testGeniusPay()).rejects.toThrow('process.exit(1)');

    exitSpy.mockRestore();
  });

  it('lève une exception si getAccountInfo throw une erreur', async () => {
    geniuspay.getAccountInfo.mockRejectedValue(new Error('Network failure'));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit(1)');
    });

    await expect(testGeniusPay()).rejects.toThrow();

    exitSpy.mockRestore();
  });
});

// ─── testGeniusPay — GENIUSPAY_WEBHOOK_SECRET absent ─────────────────────────

describe('testGeniusPay — webhook secret absent', () => {
  it('ignore le test de signature si GENIUSPAY_WEBHOOK_SECRET non défini', async () => {
    delete process.env.GENIUSPAY_WEBHOOK_SECRET;

    geniuspay.getAccountInfo.mockResolvedValue({
      success: true,
      data: { business_name: 'MANAWA', status: 'active', environment: 'sandbox' },
    });
    geniuspay.getAccountBalance.mockResolvedValue({
      success: true,
      data: { available: 0, pending: 0, total: 0 },
    });
    geniuspay.getPawapayProviders.mockResolvedValue({
      success: true,
      data: { country_name: 'CI', currency: 'XOF', providers: [] },
    });
    geniuspay.createPayment.mockResolvedValue({
      success: true,
      data: {
        reference: 'REF-NO-SECRET',
        amount: 15000,
        checkout_url: 'https://geniuspay.ci/x',
        expires_at: '2026-12-01T00:00:00Z',
      },
    });
    geniuspay.getPayment.mockResolvedValue({
      success: true,
      data: { status: 'PENDING', fees: 0, net_amount: 15000 },
    });

    // Avec secret absent, le test de signature est ignoré (early return)
    await expect(testGeniusPay()).resolves.toBeUndefined();

    // verifyWebhookSignature ne doit pas être appelé
    expect(geniuspay.verifyWebhookSignature).not.toHaveBeenCalled();
  });
});

// ─── testGeniusPay — createPayment échoue (success=false) ────────────────────

describe('testGeniusPay — createPayment success=false', () => {
  it('continue sans appeler getPayment si createPayment échoue', async () => {
    geniuspay.getAccountInfo.mockResolvedValue({
      success: true,
      data: { business_name: 'MANAWA', status: 'active', environment: 'sandbox' },
    });
    geniuspay.getAccountBalance.mockResolvedValue({
      success: true,
      data: { available: 0, pending: 0, total: 0 },
    });
    geniuspay.getPawapayProviders.mockResolvedValue({
      success: true,
      data: { country_name: 'CI', currency: 'XOF', providers: [] },
    });
    geniuspay.createPayment.mockResolvedValue({
      success: false,
      error: { message: 'Insufficient funds' },
    });
    geniuspay.verifyWebhookSignature.mockReturnValue(true);
    geniuspay.verifyWebhookTimestamp.mockReturnValue(true);

    await expect(testGeniusPay()).resolves.toBeUndefined();

    // getPayment ne doit pas être appelé si createPayment échoue
    expect(geniuspay.getPayment).not.toHaveBeenCalled();
  });
});

// ─── testGeniusPay — getAccountBalance success=false (non bloquant) ───────────

describe('testGeniusPay — getAccountBalance success=false', () => {
  it('continue l\'exécution si getAccountBalance retourne success=false', async () => {
    geniuspay.getAccountInfo.mockResolvedValue({
      success: true,
      data: { business_name: 'MANAWA', status: 'active', environment: 'sandbox' },
    });
    geniuspay.getAccountBalance.mockResolvedValue({
      success: false,
      error: { message: 'Balance unavailable' },
    });
    geniuspay.getPawapayProviders.mockResolvedValue({
      success: true,
      data: { country_name: 'CI', currency: 'XOF', providers: [] },
    });
    geniuspay.createPayment.mockResolvedValue({
      success: true,
      data: {
        reference: 'REF-BAL-FAIL',
        amount: 15000,
        checkout_url: 'https://geniuspay.ci/bal',
        expires_at: '2026-12-01T00:00:00Z',
      },
    });
    geniuspay.getPayment.mockResolvedValue({
      success: true,
      data: { status: 'PENDING', fees: 0, net_amount: 15000 },
    });
    geniuspay.verifyWebhookSignature.mockReturnValue(true);
    geniuspay.verifyWebhookTimestamp.mockReturnValue(true);

    // Doit continuer (balance failure est non-bloquante)
    await expect(testGeniusPay()).resolves.toBeUndefined();

    // getPawapayProviders doit quand même être appelé
    expect(geniuspay.getPawapayProviders).toHaveBeenCalled();
  });
});

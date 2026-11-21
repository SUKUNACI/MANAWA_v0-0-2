/**
 * Tests de la logique `enabled` de GeniusPay dans third-party-api-config.js.
 *
 * Le module est rechargé via jest.resetModules() après chaque manipulation
 * de process.env, car thirdPartyApiConfig évalue `enabled` au chargement.
 */

const ORIG_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  jest.resetModules();
  process.env.NODE_ENV = ORIG_NODE_ENV;
  delete process.env.GENIUSPAY_API_KEY;
  delete process.env.GENIUSPAY_SANDBOX_API_KEY;
});

function loadConfig() {
  return require('../../../config/third-party-api-config');
}

// ══════════════════════════════════════════════════════════════════════════════
// GeniusPay enabled — development
// ══════════════════════════════════════════════════════════════════════════════

describe('GeniusPay config.enabled — development', () => {
  test('enabled = true quand GENIUSPAY_SANDBOX_API_KEY est présente', () => {
    process.env.NODE_ENV = 'development';
    process.env.GENIUSPAY_SANDBOX_API_KEY = 'pk_sandbox_ok';
    delete process.env.GENIUSPAY_API_KEY;

    const { getConfig } = loadConfig();
    expect(getConfig('geniuspay').enabled).toBe(true);
  });

  test('enabled = false quand seule GENIUSPAY_API_KEY (live) est présente en development', () => {
    process.env.NODE_ENV = 'development';
    process.env.GENIUSPAY_API_KEY = 'pk_live_abc123';
    delete process.env.GENIUSPAY_SANDBOX_API_KEY;

    const { getConfig } = loadConfig();
    expect(getConfig('geniuspay').enabled).toBe(false);
  });

  test('enabled = false quand aucune clé n\'est présente en development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.GENIUSPAY_API_KEY;
    delete process.env.GENIUSPAY_SANDBOX_API_KEY;

    const { getConfig } = loadConfig();
    expect(getConfig('geniuspay').enabled).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GeniusPay enabled — production
// ══════════════════════════════════════════════════════════════════════════════

describe('GeniusPay config.enabled — production', () => {
  test('enabled = true quand GENIUSPAY_API_KEY est présente en production', () => {
    process.env.NODE_ENV = 'production';
    process.env.GENIUSPAY_API_KEY = 'pk_live_abc123';
    delete process.env.GENIUSPAY_SANDBOX_API_KEY;

    const { getConfig } = loadConfig();
    expect(getConfig('geniuspay').enabled).toBe(true);
  });

  test('enabled = false quand seule GENIUSPAY_SANDBOX_API_KEY est présente en production', () => {
    process.env.NODE_ENV = 'production';
    process.env.GENIUSPAY_SANDBOX_API_KEY = 'pk_sandbox_ok';
    delete process.env.GENIUSPAY_API_KEY;

    const { getConfig } = loadConfig();
    expect(getConfig('geniuspay').enabled).toBe(false);
  });
});

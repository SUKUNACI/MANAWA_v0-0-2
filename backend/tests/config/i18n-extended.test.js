const { t, detectLocale, translations, SUPPORTED_LOCALES, DEFAULT_LOCALE } = require('../../config/i18n');

describe('i18n.js — Extended localization keys', () => {
  describe('Translation completeness', () => {
    test('all keys should exist in both FR and EN', () => {
      const frKeys = Object.keys(translations.fr);
      const enKeys = Object.keys(translations.en);

      frKeys.forEach(key => {
        expect(translations.en[key]).toBeDefined();
      });

      enKeys.forEach(key => {
        expect(translations.fr[key]).toBeDefined();
      });

      expect(frKeys.length).toBe(enKeys.length);
    });

    test('should have at least 120 translation keys total (extended from 82)', () => {
      const frKeys = Object.keys(translations.fr);
      expect(frKeys.length).toBeGreaterThanOrEqual(120);
    });
  });

  describe('Error handling translations', () => {
    test('should have auth error translations', () => {
      const authKeys = [
        'auth.unauthorized',
        'auth.forbidden',
        'auth.invalid_credentials',
        'auth.token_expired',
        'auth.token_invalid',
        'auth.2fa_required',
        'auth.session_expired',
        'auth.account_locked',
      ];

      authKeys.forEach(key => {
        const fr = t(key, 'fr');
        const en = t(key, 'en');
        expect(fr).not.toBe(key);
        expect(en).not.toBe(key);
        expect(fr).toBeTruthy();
        expect(en).toBeTruthy();
      });
    });

    test('should have validation error translations', () => {
      const valKeys = [
        'validation.required',
        'validation.invalid_email',
        'validation.password_weak',
        'validation.min_length',
        'validation.invalid_date',
        'validation.must_be_unique',
      ];

      valKeys.forEach(key => {
        const fr = t(key, 'fr');
        const en = t(key, 'en');
        expect(fr).not.toBe(key);
        expect(en).not.toBe(key);
      });
    });

    test('should have payment error translations', () => {
      const payKeys = [
        'payment.insufficient',
        'payment.failed',
        'payment.timeout',
        'payment.card_invalid',
        'payment.card_expired',
        'payment.fraud_detected',
        'payment.daily_limit_exceeded',
      ];

      payKeys.forEach(key => {
        const fr = t(key, 'fr');
        const en = t(key, 'en');
        expect(fr).not.toBe(key);
        expect(en).not.toBe(key);
      });
    });

    test('should have database error translations', () => {
      const dbKeys = [
        'database.connection_failed',
        'database.query_failed',
        'database.transaction_failed',
        'database.record_not_found',
        'database.timeout',
      ];

      dbKeys.forEach(key => {
        const fr = t(key, 'fr');
        const en = t(key, 'en');
        expect(fr).not.toBe(key);
        expect(en).not.toBe(key);
      });
    });

    test('should have file operation error translations', () => {
      const fileKeys = [
        'file.not_found',
        'file.corrupted',
        'file.virus_detected',
        'file.encryption_failed',
      ];

      fileKeys.forEach(key => {
        const fr = t(key, 'fr');
        const en = t(key, 'en');
        expect(fr).not.toBe(key);
        expect(en).not.toBe(key);
      });
    });

    test('should have API error translations', () => {
      const apiKeys = [
        'api.unauthorized',
        'api.rate_limited',
        'api.invalid_request',
        'api.service_unavailable',
        'api.timeout',
      ];

      apiKeys.forEach(key => {
        const fr = t(key, 'fr');
        const en = t(key, 'en');
        expect(fr).not.toBe(key);
        expect(en).not.toBe(key);
      });
    });

    test('should have network error translations', () => {
      const networkKeys = [
        'network.connection_lost',
        'network.timeout',
        'network.dns_failed',
        'network.ssl_error',
      ];

      networkKeys.forEach(key => {
        const fr = t(key, 'fr');
        const en = t(key, 'en');
        expect(fr).not.toBe(key);
        expect(en).not.toBe(key);
      });
    });

    test('should have business error translations', () => {
      const busKeys = [
        'business.project_unavailable',
        'business.quota_exceeded',
        'business.subscription_required',
      ];

      busKeys.forEach(key => {
        const fr = t(key, 'fr');
        const en = t(key, 'en');
        expect(fr).not.toBe(key);
        expect(en).not.toBe(key);
      });
    });

    test('should have generic error translations', () => {
      const genericKeys = [
        'error.unknown',
        'error.unexpected',
        'error.try_again',
        'error.contact_support',
      ];

      genericKeys.forEach(key => {
        const fr = t(key, 'fr');
        const en = t(key, 'en');
        expect(fr).not.toBe(key);
        expect(en).not.toBe(key);
      });
    });
  });

  describe('Interpolation with new keys', () => {
    test('should support variables in min_length', () => {
      const fr = t('validation.min_length', 'fr', { min: 8 });
      const en = t('validation.min_length', 'en', { min: 8 });
      expect(fr).toContain('8');
      expect(en).toContain('8');
    });

    test('should support variables in conflicts_with', () => {
      const fr = t('validation.conflicts_with', 'fr', { field: 'email' });
      const en = t('validation.conflicts_with', 'en', { field: 'email' });
      expect(fr).toContain('email');
      expect(en).toContain('email');
    });

    test('should support payment amounts', () => {
      const fr = t('payment.success', 'fr', { amount: 5000 });
      const en = t('payment.success', 'en', { amount: 5000 });
      expect(fr).toContain('5000');
      expect(en).toContain('5000');
    });
  });

  describe('Locale detection', () => {
    test('should detect French from Accept-Language', () => {
      expect(detectLocale('fr-FR,fr;q=0.9')).toBe('fr');
      expect(detectLocale('fr')).toBe('fr');
    });

    test('should detect English from Accept-Language', () => {
      expect(detectLocale('en-US,en;q=0.9')).toBe('en');
      expect(detectLocale('en')).toBe('en');
    });

    test('should prefer most-qualified language', () => {
      expect(detectLocale('en-US,en;q=0.9,fr;q=0.8')).toBe('en');
      expect(detectLocale('fr-FR,fr;q=0.9,en;q=0.5')).toBe('fr');
    });

    test('should fallback to French for unsupported languages', () => {
      expect(detectLocale('de,es')).toBe('fr');
      expect(detectLocale('it')).toBe('fr');
      expect(detectLocale(null)).toBe('fr');
    });
  });

  describe('Key naming conventions', () => {
    test('all keys should be lowercase with dots', () => {
      Object.keys(translations.fr).forEach(key => {
        expect(key).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
      });
    });

    test('no duplicate keys across categories', () => {
      const allKeys = Object.keys(translations.fr);
      const uniqueKeys = new Set(allKeys);
      expect(allKeys.length).toBe(uniqueKeys.size);
    });
  });

  describe('Category coverage', () => {
    test('should have auth category keys', () => {
      const authKeys = Object.keys(translations.fr).filter(k => k.startsWith('auth.'));
      expect(authKeys.length).toBeGreaterThanOrEqual(10);
    });

    test('should have validation category keys', () => {
      const valKeys = Object.keys(translations.fr).filter(k => k.startsWith('validation.'));
      expect(valKeys.length).toBeGreaterThanOrEqual(10);
    });

    test('should have payment category keys', () => {
      const payKeys = Object.keys(translations.fr).filter(k => k.startsWith('payment.'));
      expect(payKeys.length).toBeGreaterThanOrEqual(13);
    });

    test('should have database category keys', () => {
      const dbKeys = Object.keys(translations.fr).filter(k => k.startsWith('database.'));
      expect(dbKeys.length).toBeGreaterThanOrEqual(8);
    });

    test('should have error category keys', () => {
      const errKeys = Object.keys(translations.fr).filter(k => k.startsWith('error.'));
      expect(errKeys.length).toBeGreaterThanOrEqual(8);
    });

    test('should have resource category keys', () => {
      const resKeys = Object.keys(translations.fr).filter(k => k.startsWith('resource.'));
      expect(resKeys.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('Translation quality', () => {
    test('no empty translations', () => {
      Object.entries(translations.fr).forEach(([key, value]) => {
        expect(value).toBeTruthy();
        expect(value.length).toBeGreaterThan(0);
      });

      Object.entries(translations.en).forEach(([key, value]) => {
        expect(value).toBeTruthy();
        expect(value.length).toBeGreaterThan(0);
      });
    });

    test('translations should be different between FR and EN (with exceptions)', () => {
      let sameCount = 0;
      Object.entries(translations.fr).forEach(([key, frValue]) => {
        const enValue = translations.en[key];
        if (frValue === enValue) {
          sameCount++;
        }
      });
      expect(sameCount).toBeLessThan(10);
    });

    test('should have comprehensive error coverage', () => {
      const categories = [
        'auth', 'validation', 'payment', 'database', 'file',
        'api', 'search', 'booking', 'notification', 'system',
        'business', 'network', 'error', 'resource', 'service',
      ];

      categories.forEach(cat => {
        const keys = Object.keys(translations.fr).filter(k => k.startsWith(cat + '.'));
        expect(keys.length).toBeGreaterThan(0, `Missing category: ${cat}`);
      });
    });
  });
});

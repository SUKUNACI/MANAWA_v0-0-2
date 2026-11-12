/**
 * Tests Q101-Q107: Internationalization
 * Q101: Multi-language support
 * Q102: Language detection
 * Q104: Multi-currency support (XOF)
 * Q106: Tax calculation (Côte d'Ivoire)
 * Q107: Timezone handling (Africa/Abidjan)
 */

const { t, detectLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } = require('../config/i18n');
const { CURRENCY, EXCHANGE_RATES, formatXOF, eurToXof, xofToEur, validateXofAmount } = require('../config/currency');
const { TAX_RATES, calculateTax, extractHtFromTtc, calculateCommission } = require('../config/tax');
const { MANAWA_TIMEZONE, formatInAbidjan, formatDateAbidjan, startOfDayAbidjan, endOfDayAbidjan, isBusinessHoursAbidjan } = require('../utils/timezone');

// ─── Q101: Multi-language support ────────────────────────────────────────────

describe('Q101: Multi-language support', () => {
  it('supported locales are fr and en', () => {
    expect(SUPPORTED_LOCALES).toEqual(['fr', 'en']);
  });

  it('default locale is fr', () => {
    expect(DEFAULT_LOCALE).toBe('fr');
  });

  it('translates key in French', () => {
    expect(t('auth.unauthorized', 'fr')).toBe('Accès non autorisé');
  });

  it('translates key in English', () => {
    expect(t('auth.unauthorized', 'en')).toBe('Unauthorized access');
  });

  it('falls back to French for unsupported locale', () => {
    expect(t('auth.unauthorized', 'de')).toBe('Accès non autorisé');
  });

  it('returns key name when key missing in all locales', () => {
    expect(t('nonexistent.key', 'fr')).toBe('nonexistent.key');
  });

  it('interpolates variables in French', () => {
    const result = t('payment.success', 'fr', { amount: 5000 });
    expect(result).toContain('5000');
    expect(result).toContain('XOF');
  });

  it('interpolates variables in English', () => {
    const result = t('payment.success', 'en', { amount: 10000 });
    expect(result).toContain('10000');
    expect(result).toContain('XOF');
  });

  it('payment messages always mention XOF regardless of locale', () => {
    expect(t('payment.success', 'fr', { amount: 1 })).toContain('XOF');
    expect(t('payment.success', 'en', { amount: 1 })).toContain('XOF');
  });
});

// ─── Q102: Language detection ─────────────────────────────────────────────────

describe('Q102: Language detection', () => {
  it('detects English from Accept-Language header', () => {
    expect(detectLocale('en-US,en;q=0.9,fr;q=0.8')).toBe('en');
  });

  it('detects French from Accept-Language header', () => {
    expect(detectLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr');
  });

  it('falls back to fr when language not supported', () => {
    expect(detectLocale('de,es;q=0.9')).toBe('fr');
  });

  it('falls back to fr when header is empty', () => {
    expect(detectLocale('')).toBe('fr');
  });

  it('falls back to fr when header is null', () => {
    expect(detectLocale(null)).toBe('fr');
  });

  it('respects quality weights — fr q=0.9 beats en q=0.5', () => {
    expect(detectLocale('fr;q=0.9,en;q=0.5')).toBe('fr');
  });

  it('picks en when it has higher q than fr', () => {
    expect(detectLocale('en;q=1.0,fr;q=0.5')).toBe('en');
  });

  it('handles header without q values (defaults to 1.0)', () => {
    expect(detectLocale('en')).toBe('en');
  });
});

// ─── Q104: Multi-currency support (XOF) ──────────────────────────────────────

describe('Q104: Multi-currency support (XOF)', () => {
  it('MANAWA currency is XOF', () => {
    expect(CURRENCY.code).toBe('XOF');
  });

  it('XOF has 0 decimals', () => {
    expect(CURRENCY.decimals).toBe(0);
  });

  it('XOF symbol is F CFA', () => {
    expect(CURRENCY.symbol).toBe('F CFA');
  });

  it('EUR/XOF rate is the official UEMOA fixed rate', () => {
    expect(EXCHANGE_RATES.EUR_TO_XOF).toBe(655.957);
  });

  it('formatXOF formats amount correctly', () => {
    const result = formatXOF(15000);
    expect(result).toContain('15');
    expect(result).toContain('F CFA');
  });

  it('formatXOF handles invalid input', () => {
    expect(formatXOF(null)).toBe('0 F CFA');
    expect(formatXOF(NaN)).toBe('0 F CFA');
  });

  it('eurToXof converts correctly', () => {
    expect(eurToXof(1)).toBe(656); // Math.round(655.957)
  });

  it('xofToEur converts correctly', () => {
    expect(xofToEur(655957)).toBeCloseTo(1000, 1);
  });

  it('validateXofAmount accepts valid amount', () => {
    expect(validateXofAmount(5000).valid).toBe(true);
  });

  it('validateXofAmount rejects amount below 100', () => {
    expect(validateXofAmount(50).valid).toBe(false);
  });

  it('validateXofAmount rejects amount above 10M', () => {
    expect(validateXofAmount(10_000_001).valid).toBe(false);
  });

  it('validateXofAmount rejects decimal amounts', () => {
    expect(validateXofAmount(1500.50).valid).toBe(false);
  });
});

// ─── Q106: Tax calculation (Côte d'Ivoire) ───────────────────────────────────

describe('Q106: Tax calculation — Côte d\'Ivoire', () => {
  it('TVA Côte d\'Ivoire is 18%', () => {
    expect(TAX_RATES.CI.vat).toBe(0.18);
  });

  it('calculateTax returns correct HT, TVA, TTC', () => {
    const result = calculateTax(10000);
    expect(result.ht).toBe(10000);
    expect(result.tva).toBe(1800);
    expect(result.ttc).toBe(11800);
  });

  it('calculateTax rate is 0.18', () => {
    expect(calculateTax(10000).rate).toBe(0.18);
  });

  it('calculateTax vatCode is CI-TVA-18', () => {
    expect(calculateTax(10000).vatCode).toBe('CI-TVA-18');
  });

  it('calculateTax rounds to nearest XOF integer', () => {
    const result = calculateTax(1001);
    expect(Number.isInteger(result.tva)).toBe(true);
    expect(Number.isInteger(result.ttc)).toBe(true);
  });

  it('extractHtFromTtc reverses calculateTax', () => {
    const result = extractHtFromTtc(11800);
    expect(result.ht).toBe(10000);
    expect(result.tva).toBe(1800);
    expect(result.ttc).toBe(11800);
  });

  it('calculateCommission applies 15% rate', () => {
    const result = calculateCommission(10000);
    expect(result.commissionHt).toBe(1500);
    expect(result.commissionRate).toBe(0.15);
  });

  it('calculateCommission professional net = transaction - commission TTC', () => {
    const result = calculateCommission(10000);
    expect(result.professionalNet).toBe(10000 - result.commissionTtc);
  });

  it('calculateCommission commission TTC includes TVA', () => {
    const result = calculateCommission(10000);
    expect(result.commissionTtc).toBe(result.commissionHt + result.commissionTva);
  });
});

// ─── Q107: Timezone handling (Africa/Abidjan) ─────────────────────────────────

describe('Q107: Timezone handling — Africa/Abidjan', () => {
  it('MANAWA_TIMEZONE is Africa/Abidjan', () => {
    expect(MANAWA_TIMEZONE).toBe('Africa/Abidjan');
  });

  it('Abidjan is GMT+0 — UTC hours equal local hours', () => {
    const date      = new Date('2026-11-12T10:00:00Z');
    const formatted = formatInAbidjan(date);
    expect(formatted).toContain('10:00');
  });

  it('formatInAbidjan returns valid string', () => {
    const result = formatInAbidjan(new Date('2026-11-12T14:30:00Z'));
    expect(typeof result).toBe('string');
    expect(result).not.toBe('Date invalide');
  });

  it('formatInAbidjan handles invalid date', () => {
    expect(formatInAbidjan(new Date('invalid'))).toBe('Date invalide');
  });

  it('formatDateAbidjan returns date with year, month, day', () => {
    const result = formatDateAbidjan(new Date('2026-11-12T10:00:00Z'));
    expect(result).toContain('2026');
    expect(result).toContain('11');
    expect(result).toContain('12');
  });

  it('startOfDayAbidjan sets UTC time to 00:00:00', () => {
    const start = startOfDayAbidjan(new Date('2026-11-12T15:30:00Z'));
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
  });

  it('endOfDayAbidjan sets UTC time to 23:59:59', () => {
    const end = endOfDayAbidjan(new Date('2026-11-12T10:00:00Z'));
    expect(end.getUTCHours()).toBe(23);
    expect(end.getUTCMinutes()).toBe(59);
    expect(end.getUTCSeconds()).toBe(59);
  });

  it('isBusinessHoursAbidjan — Monday 10h is business hours', () => {
    expect(isBusinessHoursAbidjan(new Date('2026-11-16T10:00:00Z'))).toBe(true);
  });

  it('isBusinessHoursAbidjan — Saturday is worked in Côte d\'Ivoire', () => {
    expect(isBusinessHoursAbidjan(new Date('2026-11-14T10:00:00Z'))).toBe(true);
  });

  it('isBusinessHoursAbidjan — Sunday is not business hours', () => {
    expect(isBusinessHoursAbidjan(new Date('2026-11-15T10:00:00Z'))).toBe(false);
  });

  it('isBusinessHoursAbidjan — before 8h is not business hours', () => {
    expect(isBusinessHoursAbidjan(new Date('2026-11-16T07:00:00Z'))).toBe(false);
  });

  it('isBusinessHoursAbidjan — after 18h is not business hours', () => {
    expect(isBusinessHoursAbidjan(new Date('2026-11-16T19:00:00Z'))).toBe(false);
  });

  it('startOfDayAbidjan does not mutate the original date', () => {
    const original  = new Date('2026-11-12T15:30:00Z');
    const timestamp = original.getTime();
    startOfDayAbidjan(original);
    expect(original.getTime()).toBe(timestamp);
  });
});

'use strict';

/**
 * Tests pour utils/timezone.js
 * Gestion du fuseau horaire Abidjan (Africa/Abidjan = GMT+0, sans DST)
 */

const {
  MANAWA_TIMEZONE,
  MANAWA_LOCALE,
  formatInAbidjan,
  formatDateAbidjan,
  startOfDayAbidjan,
  endOfDayAbidjan,
  isBusinessHoursAbidjan,
} = require('../../utils/timezone');

describe('timezone — constantes', () => {
  it('MANAWA_TIMEZONE vaut Africa/Abidjan', () => {
    expect(MANAWA_TIMEZONE).toBe('Africa/Abidjan');
  });

  it('MANAWA_LOCALE vaut fr-CI', () => {
    expect(MANAWA_LOCALE).toBe('fr-CI');
  });
});

describe('formatInAbidjan', () => {
  it('formate une date UTC en chaîne lisible', () => {
    // Africa/Abidjan = GMT+0 → heure identique à UTC
    const date = new Date('2026-11-12T10:30:00Z');
    const result = formatInAbidjan(date);
    // Format fr-CI attendu : "12/11/2026 10:30"
    expect(result).toMatch(/12\/11\/2026/);
    expect(result).toMatch(/10:30/);
  });

  it('accepte une chaîne ISO en plus d\'un objet Date', () => {
    const result = formatInAbidjan('2026-01-01T08:00:00Z');
    expect(result).toMatch(/01\/01\/2026/);
  });

  it('retourne "Date invalide" pour une date invalide', () => {
    expect(formatInAbidjan('not-a-date')).toBe('Date invalide');
  });

  it('retourne "Date invalide" pour NaN', () => {
    expect(formatInAbidjan(new Date('invalid'))).toBe('Date invalide');
  });

  it('accepte des options personnalisées', () => {
    const date = new Date('2026-06-15T14:00:00Z');
    // Options sans l'heure
    const result = formatInAbidjan(date, { hour: undefined, minute: undefined });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('gère minuit UTC correctement', () => {
    const result = formatInAbidjan(new Date('2026-03-01T00:00:00Z'));
    expect(result).toMatch(/01\/03\/2026/);
    expect(result).toMatch(/00:00/);
  });

  it('gère la fin de journée 23:59', () => {
    const result = formatInAbidjan(new Date('2026-12-31T23:59:00Z'));
    expect(result).toMatch(/31\/12\/2026/);
    expect(result).toMatch(/23:59/);
  });
});

describe('formatDateAbidjan', () => {
  it('formate uniquement la date sans heure', () => {
    const result = formatDateAbidjan(new Date('2026-07-14T15:30:00Z'));
    expect(result).toMatch(/14\/07\/2026/);
    // Ne doit pas contenir d'heure
    expect(result).not.toMatch(/15:30/);
  });

  it('accepte une chaîne de date', () => {
    const result = formatDateAbidjan('2026-01-01T12:00:00Z');
    expect(result).toMatch(/01\/01\/2026/);
  });

  it('retourne "Date invalide" pour une entrée invalide', () => {
    expect(formatDateAbidjan('xyz')).toBe('Date invalide');
  });

  it('retourne "Date invalide" pour undefined converti en date invalide', () => {
    expect(formatDateAbidjan('undefined')).toBe('Date invalide');
  });
});

describe('startOfDayAbidjan', () => {
  it('retourne un objet Date', () => {
    const result = startOfDayAbidjan(new Date('2026-05-10T14:30:00Z'));
    expect(result instanceof Date).toBe(true);
  });

  it('place l\'heure à 00:00:00.000 UTC', () => {
    const result = startOfDayAbidjan(new Date('2026-05-10T14:30:45Z'));
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it('conserve la date', () => {
    const result = startOfDayAbidjan(new Date('2026-11-12T14:30:00Z'));
    expect(result.getUTCDate()).toBe(12);
    expect(result.getUTCMonth()).toBe(10); // novembre = index 10
    expect(result.getUTCFullYear()).toBe(2026);
  });

  it('accepte une chaîne ISO', () => {
    const result = startOfDayAbidjan('2026-08-20T18:00:00Z');
    expect(result.getUTCHours()).toBe(0);
  });

  it('ne mute pas la date originale (si objet Date passé)', () => {
    const original = new Date('2026-05-10T14:30:00Z');
    const originalTime = original.getTime();
    startOfDayAbidjan(original);
    expect(original.getTime()).toBe(originalTime);
  });

  it('lève une erreur pour une date invalide', () => {
    expect(() => startOfDayAbidjan('invalid-date')).toThrow('Date invalide');
  });
});

describe('endOfDayAbidjan', () => {
  it('retourne un objet Date', () => {
    const result = endOfDayAbidjan(new Date('2026-05-10T14:30:00Z'));
    expect(result instanceof Date).toBe(true);
  });

  it('place l\'heure à 23:59:59.999 UTC', () => {
    const result = endOfDayAbidjan(new Date('2026-05-10T08:00:00Z'));
    expect(result.getUTCHours()).toBe(23);
    expect(result.getUTCMinutes()).toBe(59);
    expect(result.getUTCSeconds()).toBe(59);
    expect(result.getUTCMilliseconds()).toBe(999);
  });

  it('conserve la date', () => {
    const result = endOfDayAbidjan(new Date('2026-11-12T00:00:00Z'));
    expect(result.getUTCDate()).toBe(12);
  });

  it('accepte une chaîne ISO', () => {
    const result = endOfDayAbidjan('2026-08-20T18:00:00Z');
    expect(result.getUTCHours()).toBe(23);
  });

  it('lève une erreur pour une date invalide', () => {
    expect(() => endOfDayAbidjan('bad-date')).toThrow('Date invalide');
  });

  it('endOfDay > startOfDay pour le même jour', () => {
    const day = new Date('2026-09-01T10:00:00Z');
    const start = startOfDayAbidjan(day);
    const end   = endOfDayAbidjan(day);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});

describe('isBusinessHoursAbidjan', () => {
  // Lundi 2026-11-09 à 10h UTC = heure ouvrée
  const makeDateUTC = (day, hour) => {
    // day: 0=dim,1=lun,...,6=sam via setUTCDay trick
    // On construit une date manuellement
    const d = new Date('2026-11-09T00:00:00Z'); // lundi
    d.setUTCDate(d.getUTCDate() + day); // ajoute des jours
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };

  it('retourne true pour lundi 10h UTC', () => {
    // 2026-11-09 (lundi) = day 1
    const date = new Date('2026-11-09T10:00:00Z');
    expect(isBusinessHoursAbidjan(date)).toBe(true);
  });

  it('retourne true pour samedi 09h UTC', () => {
    // 2026-11-14 (samedi)
    const date = new Date('2026-11-14T09:00:00Z');
    expect(isBusinessHoursAbidjan(date)).toBe(true);
  });

  it('retourne false pour dimanche', () => {
    // 2026-11-15 (dimanche)
    const date = new Date('2026-11-15T10:00:00Z');
    expect(isBusinessHoursAbidjan(date)).toBe(false);
  });

  it('retourne false avant 8h (7h UTC)', () => {
    const date = new Date('2026-11-09T07:00:00Z'); // lundi 7h
    expect(isBusinessHoursAbidjan(date)).toBe(false);
  });

  it('retourne false à 18h exactement (hors ouverture)', () => {
    const date = new Date('2026-11-09T18:00:00Z'); // lundi 18h
    expect(isBusinessHoursAbidjan(date)).toBe(false);
  });

  it('retourne true à 8h exactement', () => {
    const date = new Date('2026-11-09T08:00:00Z'); // lundi 8h
    expect(isBusinessHoursAbidjan(date)).toBe(true);
  });

  it('retourne true à 17h59', () => {
    const date = new Date('2026-11-09T17:59:00Z'); // lundi 17:59
    expect(isBusinessHoursAbidjan(date)).toBe(true);
  });

  it('accepte une chaîne ISO', () => {
    const result = isBusinessHoursAbidjan('2026-11-10T10:00:00Z'); // mardi 10h
    expect(result).toBe(true);
  });

  it('retourne false pour vendredi 20h (hors horaires)', () => {
    const date = new Date('2026-11-13T20:00:00Z'); // vendredi 20h
    expect(isBusinessHoursAbidjan(date)).toBe(false);
  });
});

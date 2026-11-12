/**
 * Q107: Timezone handling
 * MANAWA opère uniquement en Côte d'Ivoire — timezone : Africa/Abidjan (GMT+0, pas de DST)
 */

const MANAWA_TIMEZONE = 'Africa/Abidjan';
const MANAWA_LOCALE   = 'fr-CI';

/**
 * Formate une date UTC en heure locale Abidjan
 * Ex: formatInAbidjan(new Date('2026-11-12T10:00:00Z')) → "12/11/2026 10:00"
 * (Abidjan = GMT+0, donc identique à UTC — mais explicite pour la lisibilité)
 */
function formatInAbidjan(date, options = {}) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return 'Date invalide';

  const defaultOptions = {
    timeZone: MANAWA_TIMEZONE,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  };

  return new Intl.DateTimeFormat(MANAWA_LOCALE, { ...defaultOptions, ...options }).format(d);
}

/**
 * Formate uniquement la date (sans heure) en locale Abidjan
 */
function formatDateAbidjan(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return 'Date invalide';
  return new Intl.DateTimeFormat(MANAWA_LOCALE, {
    timeZone: MANAWA_TIMEZONE,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
  }).format(d);
}

/**
 * Retourne le début de journée à Abidjan (00:00:00 UTC, car GMT+0)
 */
function startOfDayAbidjan(date) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  if (isNaN(d.getTime())) throw new Error('Date invalide');
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Retourne la fin de journée à Abidjan (23:59:59.999 UTC, car GMT+0)
 */
function endOfDayAbidjan(date) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  if (isNaN(d.getTime())) throw new Error('Date invalide');
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/**
 * Vérifie si une date est dans les heures ouvrables Abidjan (8h-18h, lun-sam)
 * Le samedi est travaillé en Côte d'Ivoire
 */
function isBusinessHoursAbidjan(date) {
  const d    = date instanceof Date ? date : new Date(date);
  const hour = d.getUTCHours(); // GMT+0 : UTC = heure locale
  const day  = d.getUTCDay();   // 0=dim, 1=lun, ..., 6=sam
  return day >= 1 && day <= 6 && hour >= 8 && hour < 18;
}

module.exports = {
  MANAWA_TIMEZONE,
  MANAWA_LOCALE,
  formatInAbidjan,
  formatDateAbidjan,
  startOfDayAbidjan,
  endOfDayAbidjan,
  isBusinessHoursAbidjan,
};

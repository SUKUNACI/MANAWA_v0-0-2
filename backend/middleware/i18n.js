/**
 * Q101/Q102: i18n middleware
 * Injecte req.locale et req.t() sur chaque requête.
 * Priorité : User.locale (si authentifié) > Accept-Language header > 'fr'
 */

const { t, detectLocale, DEFAULT_LOCALE } = require('../config/i18n');

function i18nMiddleware(req, res, next) {
  // 1. Locale explicite de l'utilisateur authentifié (défini par requireAuth avant)
  const userLocale = req.user?.locale;

  // 2. Détection depuis l'header Accept-Language
  const headerLocale = detectLocale(req.headers['accept-language']);

  req.locale = userLocale || headerLocale || DEFAULT_LOCALE;

  // Helper lié à la requête courante
  req.t = (key, vars = {}) => t(key, req.locale, vars);

  // Expose la locale dans les headers de réponse
  res.setHeader('Content-Language', req.locale);

  next();
}

module.exports = i18nMiddleware;

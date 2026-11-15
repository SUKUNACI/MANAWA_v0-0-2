/**
 * Q101: Multi-language support
 * Q102: Language detection
 * Langues supportées : fr (défaut), en
 * MANAWA opère en Côte d'Ivoire — fr est la langue principale
 */

const SUPPORTED_LOCALES = ['fr', 'en'];
const DEFAULT_LOCALE    = 'fr';

const translations = {
  fr: {
    // Auth
    'auth.unauthorized':        'Accès non autorisé',
    'auth.forbidden':           'Permission insuffisante',
    'auth.invalid_credentials': 'Email ou mot de passe incorrect',
    'auth.account_suspended':   'Votre compte a été suspendu',
    'auth.token_expired':       'Session expirée, veuillez vous reconnecter',
    'auth.2fa_required':        'Code d\'authentification à deux facteurs requis',
    'auth.2fa_invalid':         'Code 2FA invalide',
    'auth.too_many_attempts':   'Trop de tentatives, compte temporairement bloqué',

    // Validation
    'validation.required':      'Ce champ est obligatoire',
    'validation.invalid_email': 'Adresse email invalide',
    'validation.invalid_phone': 'Numéro de téléphone invalide',
    'validation.min_length':    'Trop court (minimum {min} caractères)',
    'validation.max_length':    'Trop long (maximum {max} caractères)',
    'validation.invalid_amount':'Montant invalide',
    'validation.password_weak': 'Le mot de passe est trop faible',
    'validation.invalid_format':'Format invalide',
    'validation.duplicate_entry':'Cette entrée existe déjà',

    // Ressources
    'resource.not_found':       'Ressource introuvable',
    'resource.already_exists':  'Cette ressource existe déjà',
    'resource.deleted':         'Supprimé avec succès',
    'resource.updated':         'Mis à jour avec succès',
    'resource.created':         'Créé avec succès',
    'resource.gone':            'Cette ressource n\'est plus disponible',
    'resource.deleted_error':   'Cette ressource a été supprimée',

    // Paiements (XOF)
    'payment.success':          'Paiement de {amount} XOF confirmé',
    'payment.failed':           'Paiement de {amount} XOF échoué',
    'payment.pending':          'Paiement en attente de confirmation',
    'payment.refunded':         'Remboursement de {amount} XOF effectué',
    'payment.insufficient':     'Solde insuffisant',

    // Devis
    'quote.sent':               'Devis envoyé avec succès',
    'quote.accepted':           'Devis accepté',
    'quote.rejected':           'Devis refusé',
    'quote.expired':            'Ce devis a expiré',

    // Services
    'service.unavailable':      'Service temporairement indisponible',
    'service.timeout':          'Service indisponible (timeout)',
    'service.email_failed':     'Erreur lors de l\'envoi du email',
    'service.sms_failed':       'Erreur lors de l\'envoi du SMS',
    'payment.invalid_method':   'Méthode de paiement invalide',
    'payment.timeout':          'Délai d\'attente du paiement dépassé',
    'payment.gateway_error':    'Erreur de la passerelle de paiement',
    'payment.already_processed':'Paiement déjà traité',
    'booking.conflict':         'Conflit de réservation',

    // Business
    'business.project_unavailable': 'Ce projet n\'est pas disponible',

    // Général
    'server.error':             'Une erreur est survenue, veuillez réessayer',
    'rate_limit.exceeded':      'Trop de requêtes, réessayez dans quelques minutes',
    'upload.too_large':         'Fichier trop volumineux',
    'upload.invalid_type':      'Type de fichier non autorisé',
    'upload.failed':            'Erreur lors de l\'envoi du fichier',
    'auth.token_invalid':       'Token invalide',
  },

  en: {
    // Auth
    'auth.unauthorized':        'Unauthorized access',
    'auth.forbidden':           'Insufficient permissions',
    'auth.invalid_credentials': 'Invalid email or password',
    'auth.account_suspended':   'Your account has been suspended',
    'auth.token_expired':       'Session expired, please log in again',
    'auth.2fa_required':        'Two-factor authentication code required',
    'auth.2fa_invalid':         'Invalid 2FA code',
    'auth.too_many_attempts':   'Too many attempts, account temporarily locked',

    // Validation
    'validation.required':      'This field is required',
    'validation.invalid_email': 'Invalid email address',
    'validation.invalid_phone': 'Invalid phone number',
    'validation.min_length':    'Too short (minimum {min} characters)',
    'validation.max_length':    'Too long (maximum {max} characters)',
    'validation.invalid_amount':'Invalid amount',
    'validation.password_weak': 'Password is too weak',
    'validation.invalid_format':'Invalid format',
    'validation.duplicate_entry':'This entry already exists',

    // Resources
    'resource.not_found':       'Resource not found',
    'resource.already_exists':  'This resource already exists',
    'resource.deleted':         'Successfully deleted',
    'resource.updated':         'Successfully updated',
    'resource.created':         'Successfully created',
    'resource.gone':            'This resource is no longer available',
    'resource.deleted_error':   'This resource has been deleted',

    // Payments (XOF)
    'payment.success':          'Payment of {amount} XOF confirmed',
    'payment.failed':           'Payment of {amount} XOF failed',
    'payment.pending':          'Payment pending confirmation',
    'payment.refunded':         'Refund of {amount} XOF processed',
    'payment.insufficient':     'Insufficient balance',

    // Quotes
    'quote.sent':               'Quote sent successfully',
    'quote.accepted':           'Quote accepted',
    'quote.rejected':           'Quote rejected',
    'quote.expired':            'This quote has expired',

    // Services
    'service.unavailable':      'Service temporarily unavailable',
    'service.timeout':          'Service unavailable (timeout)',
    'service.email_failed':     'Error sending email',
    'service.sms_failed':       'Error sending SMS',
    'payment.invalid_method':   'Invalid payment method',
    'payment.timeout':          'Payment timeout exceeded',
    'payment.gateway_error':    'Payment gateway error',
    'payment.already_processed':'Payment already processed',
    'booking.conflict':         'Booking conflict',

    // Business
    'business.project_unavailable': 'This project is not available',

    // General
    'server.error':             'An error occurred, please try again',
    'rate_limit.exceeded':      'Too many requests, please try again in a few minutes',
    'upload.too_large':         'File too large',
    'upload.invalid_type':      'File type not allowed',
    'upload.failed':            'File upload failed',
    'auth.token_invalid':       'Invalid token',
  },
};

/**
 * Translate a key for a given locale.
 * Supports simple interpolation: t('payment.success', 'fr', { amount: 5000 })
 */
function t(key, locale, vars = {}) {
  const lang   = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  const bundle = translations[lang] || translations[DEFAULT_LOCALE];
  let   text   = bundle[key] || translations[DEFAULT_LOCALE][key] || key;

  Object.entries(vars).forEach(([k, v]) => {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  });

  return text;
}

/**
 * Detect locale from Accept-Language header string.
 * Returns the best supported locale, defaulting to 'fr'.
 * Examples:
 *   'en-US,en;q=0.9,fr;q=0.8' → 'en'
 *   'fr-FR,fr;q=0.9'           → 'fr'
 *   'de,es'                    → 'fr' (not supported → fallback)
 */
function detectLocale(acceptLanguageHeader) {
  if (!acceptLanguageHeader) return DEFAULT_LOCALE;

  const candidates = acceptLanguageHeader
    .split(',')
    .map(part => {
      const [tag, q] = part.trim().split(';q=');
      return { lang: tag.split('-')[0].toLowerCase(), q: q ? parseFloat(q) : 1.0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of candidates) {
    if (SUPPORTED_LOCALES.includes(lang)) return lang;
  }

  return DEFAULT_LOCALE;
}

module.exports = { t, detectLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE, translations };

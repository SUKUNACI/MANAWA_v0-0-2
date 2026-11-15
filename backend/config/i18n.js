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

    // Erreurs supplémentaires Auth
    'auth.session_expired':     'Votre session a expiré',
    'auth.invalid_token':       'Token de session invalide',
    'auth.token_revoked':       'Votre token a été révoqué',
    'auth.credentials_invalid': 'Identifiants invalides',
    'auth.mfa_failed':          'Erreur authentification multi-facteurs',
    'auth.permission_denied':   'Permission refusée',
    'auth.role_required':       'Rôle insuffisant pour cette action',
    'auth.account_locked':      'Compte verrouillé temporairement',
    'auth.account_not_verified':'Compte non vérifié',
    'auth.email_not_confirmed': 'Email non confirmé',

    // Erreurs supplémentaires Validation
    'validation.invalid_url':   'URL invalide',
    'validation.invalid_date':  'Date invalide',
    'validation.future_date':   'La date doit être dans le futur',
    'validation.past_date':     'La date doit être dans le passé',
    'validation.invalid_range': 'Valeur hors plage autorisée',
    'validation.must_be_unique':'Cette valeur doit être unique',
    'validation.pattern_mismatch':'Format ne correspond pas',
    'validation.required_field':'Ce champ ne peut pas être vide',
    'validation.invalid_selection':'Sélection invalide',
    'validation.conflicts_with':'Entre en conflit avec {field}',

    // Erreurs Database
    'database.connection_failed':'Impossible de se connecter à la base de données',
    'database.query_failed':    'Erreur lors de l\'exécution de la requête',
    'database.transaction_failed':'Transaction échouée',
    'database.duplicate_key':   'Cette clé existe déjà',
    'database.constraint_violation':'Violation de contrainte',
    'database.record_not_found':'Enregistrement introuvable',
    'database.timeout':         'Délai d\'attente base de données dépassé',
    'database.corruption':      'Corruption de données détectée',

    // Erreurs Recherche
    'search.no_results':        'Aucun résultat trouvé',
    'search.query_invalid':     'Requête de recherche invalide',
    'search.index_unavailable': 'Index de recherche indisponible',
    'search.timeout':           'Recherche expirée',
    'search.malformed':         'Syntaxe de recherche incorrecte',

    // Erreurs Fichiers
    'file.not_found':           'Fichier introuvable',
    'file.access_denied':       'Accès au fichier refusé',
    'file.corrupted':           'Fichier corrompu',
    'file.unsupported_format':  'Format de fichier non supporté',
    'file.scanning_failed':     'Impossible d\'analyser le fichier',
    'file.virus_detected':      'Virus détecté dans le fichier',
    'file.encryption_failed':   'Erreur lors du chiffrement du fichier',
    'file.compression_failed':  'Erreur lors de la compression',

    // Erreurs API/Intégration
    'api.unauthorized':         'Clé API non autorisée',
    'api.rate_limited':         'Limite d\'appels API atteinte',
    'api.invalid_request':      'Requête API invalide',
    'api.invalid_response':     'Réponse API invalide',
    'api.service_unavailable':  'Service API indisponible',
    'api.timeout':              'Service API timeout',
    'api.connection_error':     'Erreur de connexion API',
    'api.authentication_failed':'Authentification API échouée',

    // Erreurs Paiement (détaillées)
    'payment.card_invalid':     'Carte bancaire invalide',
    'payment.card_expired':     'Carte bancaire expirée',
    'payment.insufficient_balance':'Solde insuffisant',
    'payment.transaction_denied':'Transaction refusée',
    'payment.fraud_detected':   'Fraude détectée',
    'payment.daily_limit_exceeded':'Limite journalière dépassée',
    'payment.monthly_limit_exceeded':'Limite mensuelle dépassée',
    'payment.duplicate_transaction':'Transaction dupliquée détectée',
    'payment.currency_mismatch':'Devise incompatible',
    'payment.processing_error': 'Erreur de traitement du paiement',
    'payment.refund_failed':    'Remboursement échoué',
    'payment.capture_failed':   'Capture du paiement échouée',
    'payment.verification_failed':'Vérification du paiement échouée',

    // Erreurs Booking/Réservation
    'booking.already_booked':   'Créneau déjà réservé',
    'booking.invalid_date':     'Date de réservation invalide',
    'booking.no_availability':  'Pas de disponibilité',
    'booking.cancellation_failed':'Impossible d\'annuler',
    'booking.modification_failed':'Impossible de modifier',
    'booking.past_date':        'Impossible de réserver une date passée',
    'booking.overlapping':      'Réservation chevauchante',

    // Erreurs Notifications
    'notification.send_failed': 'Erreur lors de l\'envoi de la notification',
    'notification.invalid_target':'Destination de notification invalide',
    'notification.delivery_failed':'Livraison de notification échouée',

    // Erreurs Système
    'system.maintenance':       'Système en maintenance',
    'system.overloaded':        'Serveur surchargé',
    'system.error':             'Erreur système',
    'system.config_error':      'Erreur de configuration',
    'system.dependency_failed': 'Dépendance système échouée',
    'system.disk_full':         'Espace disque insuffisant',
    'system.memory_error':      'Erreur mémoire système',
    'system.cpu_error':         'Problème processeur détecté',

    // Erreurs Entreprise
    'business.invalid_state':   'État invalide',
    'business.operation_not_allowed':'Opération non autorisée',
    'business.quota_exceeded':  'Quota dépassé',
    'business.limit_reached':   'Limite atteinte',
    'business.insufficient_credits':'Crédits insuffisants',
    'business.subscription_required':'Abonnement requis',
    'business.plan_not_supported':'Plan non supporté',

    // Erreurs Réseau
    'network.connection_lost':  'Connexion perdue',
    'network.timeout':          'Délai d\'attente réseau dépassé',
    'network.dns_failed':       'Résolution DNS échouée',
    'network.ssl_error':        'Erreur SSL/TLS',
    'network.certificate_error':'Erreur de certificat',
    'network.proxy_error':      'Erreur du proxy',

    // Messages génériques
    'error.unknown':            'Erreur inconnue',
    'error.unexpected':         'Erreur inattendue',
    'error.try_again':          'Veuillez réessayer',
    'error.contact_support':    'Contactez le support',
    'error.check_connection':   'Vérifiez votre connexion',
    'error.retry_later':        'Réessayez ultérieurement',
    'error.refresh_page':       'Actualisez la page',
    'error.clear_cache':        'Videz le cache et réessayez',

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

    // Additional Auth Errors
    'auth.session_expired':     'Your session has expired',
    'auth.invalid_token':       'Invalid session token',
    'auth.token_revoked':       'Your token has been revoked',
    'auth.credentials_invalid': 'Invalid credentials',
    'auth.mfa_failed':          'Multi-factor authentication failed',
    'auth.permission_denied':   'Permission denied',
    'auth.role_required':       'Insufficient role for this action',
    'auth.account_locked':      'Account temporarily locked',
    'auth.account_not_verified':'Account not verified',
    'auth.email_not_confirmed': 'Email not confirmed',

    // Additional Validation Errors
    'validation.invalid_url':   'Invalid URL',
    'validation.invalid_date':  'Invalid date',
    'validation.future_date':   'Date must be in the future',
    'validation.past_date':     'Date must be in the past',
    'validation.invalid_range': 'Value out of allowed range',
    'validation.must_be_unique':'This value must be unique',
    'validation.pattern_mismatch':'Format does not match',
    'validation.required_field':'This field cannot be empty',
    'validation.invalid_selection':'Invalid selection',
    'validation.conflicts_with':'Conflicts with {field}',

    // Database Errors
    'database.connection_failed':'Failed to connect to database',
    'database.query_failed':    'Query execution failed',
    'database.transaction_failed':'Transaction failed',
    'database.duplicate_key':   'This key already exists',
    'database.constraint_violation':'Constraint violation',
    'database.record_not_found':'Record not found',
    'database.timeout':         'Database timeout exceeded',
    'database.corruption':      'Data corruption detected',

    // Search Errors
    'search.no_results':        'No results found',
    'search.query_invalid':     'Invalid search query',
    'search.index_unavailable': 'Search index unavailable',
    'search.timeout':           'Search timed out',
    'search.malformed':         'Search syntax error',

    // File Errors
    'file.not_found':           'File not found',
    'file.access_denied':       'File access denied',
    'file.corrupted':           'File corrupted',
    'file.unsupported_format':  'Unsupported file format',
    'file.scanning_failed':     'Unable to scan file',
    'file.virus_detected':      'Virus detected in file',
    'file.encryption_failed':   'File encryption failed',
    'file.compression_failed':  'File compression failed',

    // API/Integration Errors
    'api.unauthorized':         'API key not authorized',
    'api.rate_limited':         'API call limit reached',
    'api.invalid_request':      'Invalid API request',
    'api.invalid_response':     'Invalid API response',
    'api.service_unavailable':  'API service unavailable',
    'api.timeout':              'API service timeout',
    'api.connection_error':     'API connection error',
    'api.authentication_failed':'API authentication failed',

    // Detailed Payment Errors
    'payment.card_invalid':     'Invalid card',
    'payment.card_expired':     'Card expired',
    'payment.insufficient_balance':'Insufficient balance',
    'payment.transaction_denied':'Transaction denied',
    'payment.fraud_detected':   'Fraud detected',
    'payment.daily_limit_exceeded':'Daily limit exceeded',
    'payment.monthly_limit_exceeded':'Monthly limit exceeded',
    'payment.duplicate_transaction':'Duplicate transaction detected',
    'payment.currency_mismatch':'Currency mismatch',
    'payment.processing_error': 'Payment processing error',
    'payment.refund_failed':    'Refund failed',
    'payment.capture_failed':   'Payment capture failed',
    'payment.verification_failed':'Payment verification failed',

    // Booking/Reservation Errors
    'booking.already_booked':   'Time slot already booked',
    'booking.invalid_date':     'Invalid booking date',
    'booking.no_availability':  'No availability',
    'booking.cancellation_failed':'Unable to cancel',
    'booking.modification_failed':'Unable to modify',
    'booking.past_date':        'Cannot book past date',
    'booking.overlapping':      'Overlapping booking',

    // Notification Errors
    'notification.send_failed': 'Failed to send notification',
    'notification.invalid_target':'Invalid notification target',
    'notification.delivery_failed':'Notification delivery failed',

    // System Errors
    'system.maintenance':       'System under maintenance',
    'system.overloaded':        'Server overloaded',
    'system.error':             'System error',
    'system.config_error':      'Configuration error',
    'system.dependency_failed': 'System dependency failed',
    'system.disk_full':         'Insufficient disk space',
    'system.memory_error':      'System memory error',
    'system.cpu_error':         'CPU problem detected',

    // Business Errors
    'business.invalid_state':   'Invalid state',
    'business.operation_not_allowed':'Operation not allowed',
    'business.quota_exceeded':  'Quota exceeded',
    'business.limit_reached':   'Limit reached',
    'business.insufficient_credits':'Insufficient credits',
    'business.subscription_required':'Subscription required',
    'business.plan_not_supported':'Plan not supported',

    // Network Errors
    'network.connection_lost':  'Connection lost',
    'network.timeout':          'Network timeout exceeded',
    'network.dns_failed':       'DNS resolution failed',
    'network.ssl_error':        'SSL/TLS error',
    'network.certificate_error':'Certificate error',
    'network.proxy_error':      'Proxy error',

    // Generic Messages
    'error.unknown':            'Unknown error',
    'error.unexpected':         'Unexpected error',
    'error.try_again':          'Please try again',
    'error.contact_support':    'Contact support',
    'error.check_connection':   'Check your connection',
    'error.retry_later':        'Try again later',
    'error.refresh_page':       'Refresh the page',
    'error.clear_cache':        'Clear cache and try again',

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

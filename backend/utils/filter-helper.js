/**
 * Filter Helper - Q65: Filtering Options
 * Valide et applique les filtres aux requêtes de recherche
 *
 * Filtres supportés par endpoint (whitelist):
 * - professionals: minRating, maxRating, minPrice, maxPrice, city, verifiedOnly
 * - portfolio: (extensible)
 * - packages: minPrice, maxPrice, verifiedOnly
 * - projects: (extensible)
 * - reviews: minRating, maxRating
 */

const logger = require('./logger');

/**
 * Whitelist de filtres par endpoint
 */
const FILTER_WHITELIST = {
  professionals: ['minRating', 'maxRating', 'minPrice', 'maxPrice', 'city', 'verifiedOnly'],
  portfolio: ['city', 'category'],
  packages: ['minPrice', 'maxPrice', 'verifiedOnly', 'category'],
  projects: ['city', 'minBudget', 'maxBudget', 'category'],
  reviews: ['minRating', 'maxRating'],
};

/**
 * Types et validations pour chaque filtre
 */
const FILTER_VALIDATORS = {
  minRating: (val) => {
    const n = parseFloat(val);
    return !isNaN(n) && n >= 0 && n <= 5 ? n : null;
  },
  maxRating: (val) => {
    const n = parseFloat(val);
    return !isNaN(n) && n >= 0 && n <= 5 ? n : null;
  },
  minPrice: (val) => {
    const n = parseFloat(val);
    return !isNaN(n) && n >= 0 ? n : null;
  },
  maxPrice: (val) => {
    const n = parseFloat(val);
    return !isNaN(n) && n >= 0 ? n : null;
  },
  minBudget: (val) => {
    const n = parseFloat(val);
    return !isNaN(n) && n >= 0 ? n : null;
  },
  maxBudget: (val) => {
    const n = parseFloat(val);
    return !isNaN(n) && n >= 0 ? n : null;
  },
  city: (val) => {
    const str = String(val || '').trim();
    return str.length >= 2 && str.length <= 100 ? str : null;
  },
  category: (val) => {
    const str = String(val || '').trim();
    return str.length >= 2 && str.length <= 100 ? str : null;
  },
  verifiedOnly: (val) => {
    return val === 'true' || val === true ? true : val === 'false' || val === false ? false : null;
  },
};

/**
 * Valide et nettoie les filtres pour un endpoint donné
 * @param {string} endpoint - Nom de l'endpoint (e.g., 'professionals')
 * @param {object} rawFilters - Objet contenant les filtres bruts
 * @returns {object} Filtres validés et nettoyés
 */
function validateFilters(endpoint, rawFilters = {}) {
  const result = { validated: {}, errors: [] };

  if (!FILTER_WHITELIST[endpoint]) {
    logger.warn('[FilterHelper] Unknown endpoint', { endpoint });
    return result;
  }

  const allowed = FILTER_WHITELIST[endpoint];

  for (const filterKey of Object.keys(rawFilters)) {
    // Vérifier que le filtre est dans la whitelist
    if (!allowed.includes(filterKey)) {
      result.errors.push(`Filtre non autorisé pour ${endpoint}: ${filterKey}`);
      continue;
    }

    const validator = FILTER_VALIDATORS[filterKey];
    if (!validator) {
      result.errors.push(`Validateur non trouvé pour le filtre: ${filterKey}`);
      continue;
    }

    const cleanValue = validator(rawFilters[filterKey]);
    if (cleanValue === null) {
      result.errors.push(`Valeur invalide pour le filtre ${filterKey}: ${rawFilters[filterKey]}`);
      continue;
    }

    result.validated[filterKey] = cleanValue;
  }

  return result;
}

/**
 * Applique les filtres validés à une requête Prisma pour les professionnels
 * @param {object} where - Objet where Prisma
 * @param {object} filters - Filtres validés
 * @returns {object} Objet where modifié
 */
function applyProfessionalFilters(where, filters) {
  if (!filters || Object.keys(filters).length === 0) return where;

  if (filters.minRating !== undefined || filters.maxRating !== undefined) {
    where.averageRating = {};
    if (filters.minRating !== undefined) where.averageRating.gte = filters.minRating;
    if (filters.maxRating !== undefined) where.averageRating.lte = filters.maxRating;
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    // Appliquer sur l'abonnement (exemple : prix du forfait)
    where.subscription = where.subscription || {};
    where.subscription.OR = [];
    if (filters.minPrice !== undefined) {
      where.subscription.OR.push({ monthlyPrice: { gte: filters.minPrice } });
    }
    if (filters.maxPrice !== undefined) {
      where.subscription.OR.push({ monthlyPrice: { lte: filters.maxPrice } });
    }
  }

  if (filters.city !== undefined) {
    where.user = where.user || {};
    where.user.city = {
      contains: filters.city,
      mode: 'insensitive',
    };
  }

  if (filters.verifiedOnly === true) {
    where.verifiedByAdmin = true;
  }

  return where;
}

/**
 * Applique les filtres validés à une requête Prisma pour les forfaits
 * @param {object} where - Objet where Prisma
 * @param {object} filters - Filtres validés
 * @returns {object} Objet where modifié
 */
function applyPackageFilters(where, filters) {
  if (!filters || Object.keys(filters).length === 0) return where;

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.price = {};
    if (filters.minPrice !== undefined) where.price.gte = filters.minPrice;
    if (filters.maxPrice !== undefined) where.price.lte = filters.maxPrice;
  }

  if (filters.category !== undefined) {
    where.category = {
      contains: filters.category,
      mode: 'insensitive',
    };
  }

  if (filters.verifiedOnly === true) {
    where.professional = where.professional || {};
    where.professional.verifiedByAdmin = true;
  }

  return where;
}

/**
 * Applique les filtres validés à une requête Prisma pour les réalisations portfolio
 * @param {object} where - Objet where Prisma
 * @param {object} filters - Filtres validés
 * @returns {object} Objet where modifié
 */
function applyPortfolioFilters(where, filters) {
  if (!filters || Object.keys(filters).length === 0) return where;

  if (filters.city !== undefined) {
    where.professional = where.professional || {};
    where.professional.user = where.professional.user || {};
    where.professional.user.city = {
      contains: filters.city,
      mode: 'insensitive',
    };
  }

  if (filters.category !== undefined) {
    where.tradeCategory = {
      contains: filters.category,
      mode: 'insensitive',
    };
  }

  return where;
}

/**
 * Applique les filtres validés à une requête Prisma pour les projets
 * @param {object} where - Objet where Prisma
 * @param {object} filters - Filtres validés
 * @returns {object} Objet where modifié
 */
function applyProjectFilters(where, filters) {
  if (!filters || Object.keys(filters).length === 0) return where;

  if (filters.city !== undefined) {
    where.location = {
      contains: filters.city,
      mode: 'insensitive',
    };
  }

  if (filters.minBudget !== undefined || filters.maxBudget !== undefined) {
    where.budget = {};
    if (filters.minBudget !== undefined) where.budget.gte = filters.minBudget;
    if (filters.maxBudget !== undefined) where.budget.lte = filters.maxBudget;
  }

  if (filters.category !== undefined) {
    where.category = {
      contains: filters.category,
      mode: 'insensitive',
    };
  }

  return where;
}

/**
 * Applique les filtres validés à une requête Prisma pour les avis
 * @param {object} where - Objet where Prisma
 * @param {object} filters - Filtres validés
 * @returns {object} Objet where modifié
 */
function applyReviewFilters(where, filters) {
  if (!filters || Object.keys(filters).length === 0) return where;

  if (filters.minRating !== undefined || filters.maxRating !== undefined) {
    where.rating = {};
    if (filters.minRating !== undefined) where.rating.gte = filters.minRating;
    if (filters.maxRating !== undefined) where.rating.lte = filters.maxRating;
  }

  return where;
}

/**
 * Applique les filtres au bon endpoint
 * @param {string} endpoint - Nom de l'endpoint
 * @param {object} where - Objet where Prisma
 * @param {object} filters - Filtres validés
 * @returns {object} Objet where modifié
 */
function applyFilters(endpoint, where, filters) {
  switch (endpoint) {
    case 'professionals':
      return applyProfessionalFilters(where, filters);
    case 'packages':
      return applyPackageFilters(where, filters);
    case 'portfolio':
      return applyPortfolioFilters(where, filters);
    case 'projects':
      return applyProjectFilters(where, filters);
    case 'reviews':
      return applyReviewFilters(where, filters);
    default:
      return where;
  }
}

module.exports = {
  validateFilters,
  applyFilters,
  applyProfessionalFilters,
  applyPackageFilters,
  applyPortfolioFilters,
  applyProjectFilters,
  applyReviewFilters,
  FILTER_WHITELIST,
};

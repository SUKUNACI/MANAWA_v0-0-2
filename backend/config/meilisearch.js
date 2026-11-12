/**
 * MeiliSearch Configuration - Q66: Full-Text Search Support
 *
 * Configuration du client MeiliSearch pour la recherche complète
 * Indices: professionals, projects, portfolio, packages, reviews
 *
 * Usage:
 *   const { client, ensureIndices } = require('./config/meilisearch');
 *   await ensureIndices();
 *   const results = await client.index('professionals').search('query');
 */

const { MeiliSearch } = require('meilisearch');
const logger = require('../utils/logger');

const MEILISEARCH_URL = process.env.MEILISEARCH_URL || 'http://localhost:7700';
const MEILISEARCH_API_KEY = process.env.MEILISEARCH_API_KEY || 'masterKey';

// Initialiser le client MeiliSearch
const client = new MeiliSearch({
  host: MEILISEARCH_URL,
  apiKey: MEILISEARCH_API_KEY,
});

/**
 * Configuration des indices MeiliSearch
 */
const INDICES_CONFIG = {
  professionals: {
    name: 'professionals',
    primaryKey: 'id',
    searchableAttributes: ['firstName', 'lastName', 'trade', 'trades', 'companyName', 'description', 'city'],
    filterableAttributes: ['averageRating', 'reviewCount', 'verifiedByAdmin', 'city', 'subscription.tier', 'subscription.monthlyPrice'],
    sortableAttributes: ['averageRating', 'reviewCount', 'createdAt'],
    settings: {
      pagination: {
        maxTotalHits: 1000,
      },
      displayedAttributes: ['id', 'userId', 'firstName', 'lastName', 'trade', 'trades', 'companyName', 'avatarUrl', 'city', 'averageRating', 'reviewCount', 'verifiedByAdmin', 'subscription'],
    },
  },
  projects: {
    name: 'projects',
    primaryKey: 'id',
    searchableAttributes: ['title', 'description', 'location', 'category'],
    filterableAttributes: ['budget', 'status', 'category', 'location'],
    sortableAttributes: ['budget', 'createdAt', 'updatedAt'],
    settings: {
      pagination: {
        maxTotalHits: 1000,
      },
      displayedAttributes: ['id', 'title', 'description', 'location', 'budget', 'category', 'status', 'createdAt'],
    },
  },
  portfolio: {
    name: 'portfolio',
    primaryKey: 'id',
    searchableAttributes: ['title', 'description', 'tradeCategory', 'professionalName', 'city'],
    filterableAttributes: ['tradeCategory', 'city', 'verifiedByAdmin'],
    sortableAttributes: ['createdAt'],
    settings: {
      pagination: {
        maxTotalHits: 1000,
      },
      displayedAttributes: ['id', 'title', 'description', 'tradeCategory', 'professionalName', 'city', 'images'],
    },
  },
  packages: {
    name: 'packages',
    primaryKey: 'id',
    searchableAttributes: ['title', 'description', 'category', 'professionalName'],
    filterableAttributes: ['price', 'category', 'verifiedByAdmin'],
    sortableAttributes: ['price', 'ordersCount', 'createdAt'],
    settings: {
      pagination: {
        maxTotalHits: 1000,
      },
      displayedAttributes: ['id', 'title', 'description', 'price', 'category', 'duration', 'ordersCount', 'professionalName', 'images'],
    },
  },
  reviews: {
    name: 'reviews',
    primaryKey: 'id',
    searchableAttributes: ['comment', 'professionalName', 'authorName'],
    filterableAttributes: ['rating', 'professionalId'],
    sortableAttributes: ['rating', 'createdAt'],
    settings: {
      pagination: {
        maxTotalHits: 1000,
      },
      displayedAttributes: ['id', 'rating', 'comment', 'professionalName', 'authorName', 'createdAt'],
    },
  },
};

/**
 * S'assurer que tous les indices existent et sont configurés correctement
 */
async function ensureIndices() {
  try {
    logger.info('[MeiliSearch] Vérification des indices...');

    for (const indexName of Object.keys(INDICES_CONFIG)) {
      const config = INDICES_CONFIG[indexName];
      try {
        // Vérifier si l'indice existe
        const index = await client.getIndex(indexName);
        logger.info(`[MeiliSearch] Indice '${indexName}' existe`, { primaryKey: config.primaryKey });
      } catch (err) {
        if (err.code === 'index_not_found') {
          // Créer l'indice
          logger.info(`[MeiliSearch] Création de l'indice '${indexName}'...`);
          await client.createIndex(indexName, { primaryKey: config.primaryKey });
          logger.info(`[MeiliSearch] Indice '${indexName}' créé`);
        } else {
          throw err;
        }
      }

      // Mettre à jour les paramètres de l'indice
      const index = await client.getIndex(indexName);
      await index.updateSearchableAttributes(config.searchableAttributes);
      await index.updateFilterableAttributes(config.filterableAttributes);
      await index.updateSortableAttributes(config.sortableAttributes);

      logger.debug(`[MeiliSearch] Indice '${indexName}' configuré`);
    }

    logger.info('[MeiliSearch] Tous les indices sont prêts');
    return true;
  } catch (err) {
    logger.error('[MeiliSearch] Erreur configuration indices', { error: err.message });
    throw err;
  }
}

/**
 * Obtenir un indice MeiliSearch
 * @param {string} indexName - Nom de l'indice
 * @returns {object} L'indice MeiliSearch
 */
function getIndex(indexName) {
  if (!INDICES_CONFIG[indexName]) {
    throw new Error(`Indice MeiliSearch inconnu: ${indexName}`);
  }
  return client.index(indexName);
}

/**
 * Vérifie la disponibilité de MeiliSearch
 */
async function healthCheck() {
  try {
    const health = await client.health();
    logger.info('[MeiliSearch] Health check OK', { status: health.status });
    return { status: 'ok', details: health };
  } catch (err) {
    logger.error('[MeiliSearch] Health check FAILED', { error: err.message });
    return { status: 'error', error: err.message };
  }
}

/**
 * Recherche globale dans tous les indices
 * @param {string} query - Terme de recherche
 * @param {object} options - Options (filters, limit, offset, etc.)
 * @returns {object} Résultats agrégés de tous les indices
 */
async function globalSearch(query, options = {}) {
  const { limit = 10, offset = 0, filters = [] } = options;
  const results = {};

  try {
    // Rechercher dans chaque indice en parallèle
    const searches = await Promise.all([
      getIndex('professionals').search(query, { limit, offset, filter: filters }).catch(err => {
        logger.warn('[MeiliSearch] Erreur recherche professionals', { error: err.message });
        return { hits: [] };
      }),
      getIndex('projects').search(query, { limit, offset, filter: filters }).catch(err => {
        logger.warn('[MeiliSearch] Erreur recherche projects', { error: err.message });
        return { hits: [] };
      }),
      getIndex('portfolio').search(query, { limit, offset, filter: filters }).catch(err => {
        logger.warn('[MeiliSearch] Erreur recherche portfolio', { error: err.message });
        return { hits: [] };
      }),
      getIndex('packages').search(query, { limit, offset, filter: filters }).catch(err => {
        logger.warn('[MeiliSearch] Erreur recherche packages', { error: err.message });
        return { hits: [] };
      }),
      getIndex('reviews').search(query, { limit, offset, filter: filters }).catch(err => {
        logger.warn('[MeiliSearch] Erreur recherche reviews', { error: err.message });
        return { hits: [] };
      }),
    ]);

    results.professionals = searches[0];
    results.projects = searches[1];
    results.portfolio = searches[2];
    results.packages = searches[3];
    results.reviews = searches[4];

    return results;
  } catch (err) {
    logger.error('[MeiliSearch] Erreur recherche globale', { error: err.message });
    throw err;
  }
}

module.exports = {
  client,
  getIndex,
  ensureIndices,
  healthCheck,
  globalSearch,
  INDICES_CONFIG,
};

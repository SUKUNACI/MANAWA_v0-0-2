/**
 * MeiliSearch Sync Job - Q66: Data Synchronization
 *
 * Synchronise les données de la base de données avec MeiliSearch
 * Exécuté quotidiennement (cron) et à la demande
 *
 * Indices synchronisés: professionals, projects, portfolio, packages, reviews
 */

const prisma = require('../config/db');
const { getIndex, ensureIndices } = require('../config/meilisearch');
const logger = require('../utils/logger');

const BATCH_SIZE = 100;
const MAX_RETRIES = 3;

/**
 * Récupère tous les professionnels depuis la BD et les formate pour MeiliSearch
 */
async function syncProfessionals() {
  logger.info('[MeiliSearch] Synchronisation des professionnels...');

  try {
    const index = getIndex('professionals');
    let synced = 0;
    let skip = 0;

    while (true) {
      const professionals = await prisma.professional.findMany({
        where: { user: { deletedAt: null } },
        include: {
          user: {
            select: { firstName: true, lastName: true, city: true, avatar: true },
          },
          subscription: {
            select: { tier: true, monthlyPrice: true },
          },
        },
        skip,
        take: BATCH_SIZE,
      });

      if (professionals.length === 0) break;

      // Formatter les données pour MeiliSearch
      const formatted = professionals.map(p => ({
        id: p.id,
        userId: p.userId,
        firstName: p.user?.firstName || '',
        lastName: p.user?.lastName || '',
        trade: p.trade,
        trades: p.trades || [],
        companyName: p.companyName || '',
        description: p.description || '',
        city: p.user?.city || '',
        avatarUrl: p.user?.avatar || '',
        averageRating: parseFloat(p.averageRating) || 0,
        reviewCount: p.reviewCount || 0,
        verifiedByAdmin: p.verifiedByAdmin || false,
        subscription: {
          tier: p.subscription?.tier || 'free',
          monthlyPrice: p.subscription?.monthlyPrice || 0,
        },
        createdAt: p.createdAt?.toISOString(),
      }));

      // Ajouter au batch MeiliSearch
      for (let i = 0; i < formatted.length; i += BATCH_SIZE) {
        const batch = formatted.slice(i, i + BATCH_SIZE);
        await index.addDocuments(batch, { primaryKey: 'id' });
        synced += batch.length;
      }

      skip += BATCH_SIZE;
    }

    logger.info('[MeiliSearch] Professionnels synchronisés', { count: synced });
    return { success: true, synced };
  } catch (err) {
    logger.error('[MeiliSearch] Erreur sync professionnels', { error: err.message });
    throw err;
  }
}

/**
 * Récupère tous les projets depuis la BD et les formate pour MeiliSearch
 */
async function syncProjects() {
  logger.info('[MeiliSearch] Synchronisation des projets...');

  try {
    const index = getIndex('projects');
    let synced = 0;
    let skip = 0;

    while (true) {
      const projects = await prisma.project.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          description: true,
          location: true,
          budget: true,
          category: true,
          status: true,
          createdAt: true,
        },
        skip,
        take: BATCH_SIZE,
      });

      if (projects.length === 0) break;

      const formatted = projects.map(p => ({
        id: p.id,
        title: p.title || '',
        description: p.description || '',
        location: p.location || '',
        budget: parseFloat(p.budget) || 0,
        category: p.category || '',
        status: p.status || 'open',
        createdAt: p.createdAt?.toISOString(),
      }));

      for (let i = 0; i < formatted.length; i += BATCH_SIZE) {
        const batch = formatted.slice(i, i + BATCH_SIZE);
        await index.addDocuments(batch, { primaryKey: 'id' });
        synced += batch.length;
      }

      skip += BATCH_SIZE;
    }

    logger.info('[MeiliSearch] Projets synchronisés', { count: synced });
    return { success: true, synced };
  } catch (err) {
    logger.error('[MeiliSearch] Erreur sync projets', { error: err.message });
    throw err;
  }
}

/**
 * Récupère tous les portfolios depuis la BD et les formate pour MeiliSearch
 */
async function syncPortfolio() {
  logger.info('[MeiliSearch] Synchronisation du portfolio...');

  try {
    const index = getIndex('portfolio');
    let synced = 0;
    let skip = 0;

    while (true) {
      const portfolios = await prisma.portfolioProject.findMany({
        where: { professional: { user: { deletedAt: null } } },
        include: {
          professional: {
            include: {
              user: { select: { firstName: true, lastName: true, city: true } },
            },
          },
          images: {
            select: { imageUrl: true },
            orderBy: { sortOrder: 'asc' },
            take: 3,
          },
        },
        skip,
        take: BATCH_SIZE,
      });

      if (portfolios.length === 0) break;

      const formatted = portfolios.map(p => ({
        id: p.id,
        title: p.title || '',
        description: p.description || '',
        tradeCategory: p.tradeCategory || '',
        professionalName: `${p.professional?.user?.firstName || ''} ${p.professional?.user?.lastName || ''}`.trim(),
        city: p.professional?.user?.city || '',
        verifiedByAdmin: p.professional?.verifiedByAdmin || false,
        images: p.images?.map(img => img.imageUrl) || [],
        createdAt: p.createdAt?.toISOString(),
      }));

      for (let i = 0; i < formatted.length; i += BATCH_SIZE) {
        const batch = formatted.slice(i, i + BATCH_SIZE);
        await index.addDocuments(batch, { primaryKey: 'id' });
        synced += batch.length;
      }

      skip += BATCH_SIZE;
    }

    logger.info('[MeiliSearch] Portfolio synchronisé', { count: synced });
    return { success: true, synced };
  } catch (err) {
    logger.error('[MeiliSearch] Erreur sync portfolio', { error: err.message });
    throw err;
  }
}

/**
 * Récupère tous les forfaits depuis la BD et les formate pour MeiliSearch
 */
async function syncPackages() {
  logger.info('[MeiliSearch] Synchronisation des forfaits...');

  try {
    const index = getIndex('packages');
    let synced = 0;
    let skip = 0;

    while (true) {
      const packages = await prisma.servicePackage.findMany({
        where: { active: true, professional: { user: { deletedAt: null } } },
        include: {
          professional: {
            select: {
              id: true,
              verifiedByAdmin: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
        skip,
        take: BATCH_SIZE,
      });

      if (packages.length === 0) break;

      const formatted = packages.map(p => ({
        id: p.id,
        title: p.title || '',
        description: p.description || '',
        price: parseFloat(p.price) || 0,
        category: p.category || '',
        duration: p.duration || '',
        ordersCount: p.ordersCount || 0,
        professionalName: `${p.professional?.user?.firstName || ''} ${p.professional?.user?.lastName || ''}`.trim(),
        verifiedByAdmin: p.professional?.verifiedByAdmin || false,
        images: p.images || [],
        createdAt: p.createdAt?.toISOString(),
      }));

      for (let i = 0; i < formatted.length; i += BATCH_SIZE) {
        const batch = formatted.slice(i, i + BATCH_SIZE);
        await index.addDocuments(batch, { primaryKey: 'id' });
        synced += batch.length;
      }

      skip += BATCH_SIZE;
    }

    logger.info('[MeiliSearch] Forfaits synchronisés', { count: synced });
    return { success: true, synced };
  } catch (err) {
    logger.error('[MeiliSearch] Erreur sync forfaits', { error: err.message });
    throw err;
  }
}

/**
 * Récupère tous les avis depuis la BD et les formate pour MeiliSearch
 */
async function syncReviews() {
  logger.info('[MeiliSearch] Synchronisation des avis...');

  try {
    const index = getIndex('reviews');
    let synced = 0;
    let skip = 0;

    while (true) {
      const reviews = await prisma.review.findMany({
        include: {
          professional: {
            select: { user: { select: { firstName: true, lastName: true } } },
          },
          reviewer: {
            select: { firstName: true, lastName: true },
          },
        },
        skip,
        take: BATCH_SIZE,
      });

      if (reviews.length === 0) break;

      const formatted = reviews.map(r => ({
        id: r.id,
        rating: r.rating || 0,
        comment: r.comment || '',
        professionalName: `${r.professional?.user?.firstName || ''} ${r.professional?.user?.lastName || ''}`.trim(),
        authorName: `${r.reviewer?.firstName || ''} ${r.reviewer?.lastName || ''}`.trim(),
        professionalId: r.professionalId,
        createdAt: r.createdAt?.toISOString(),
      }));

      for (let i = 0; i < formatted.length; i += BATCH_SIZE) {
        const batch = formatted.slice(i, i + BATCH_SIZE);
        await index.addDocuments(batch, { primaryKey: 'id' });
        synced += batch.length;
      }

      skip += BATCH_SIZE;
    }

    logger.info('[MeiliSearch] Avis synchronisés', { count: synced });
    return { success: true, synced };
  } catch (err) {
    logger.error('[MeiliSearch] Erreur sync avis', { error: err.message });
    throw err;
  }
}

/**
 * Synchronise tous les indices
 */
async function syncAllIndices() {
  const startTime = Date.now();
  const results = {};

  try {
    logger.info('[MeiliSearch] Début synchronisation complète...');

    // Assurer que les indices existent
    await ensureIndices();

    // Synchroniser chaque indice
    results.professionals = await syncProfessionals();
    results.projects = await syncProjects();
    results.portfolio = await syncPortfolio();
    results.packages = await syncPackages();
    results.reviews = await syncReviews();

    const duration = Date.now() - startTime;
    logger.info('[MeiliSearch] Synchronisation complète terminée', { duration: `${duration}ms`, results });

    return { success: true, results, duration };
  } catch (err) {
    logger.error('[MeiliSearch] Erreur synchronisation complète', { error: err.message });
    throw err;
  }
}

module.exports = {
  syncAllIndices,
  syncProfessionals,
  syncProjects,
  syncPortfolio,
  syncPackages,
  syncReviews,
};

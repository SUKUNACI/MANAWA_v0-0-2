/**
 * Centralized Performance Optimization Configuration
 *
 * This module contains all performance settings and strategies:
 * - Database query optimization (N+1 prevention, lazy loading)
 * - Cache TTL and invalidation
 * - Compression and minification
 * - Query result caching strategies
 */

// Cache TTL Configuration (in seconds)
const CACHE_TTL = {
  // Frequently accessed data - shorter TTL
  PROFESSIONAL_LIST: 300,      // 5 min - professional listings change often
  PROFESSIONAL_DETAIL: 600,    // 10 min - detailed profile
  PROJECTS_LIST: 300,           // 5 min - projects change frequently
  PROJECT_DETAIL: 600,          // 10 min - single project

  // Moderation heavy data - medium TTL
  DASHBOARD_KPI: 300,           // 5 min - KPIs update regularly
  ANALYTICS: 300,               // 5 min - analytics queries
  SEARCH_RESULTS: 600,          // 10 min - search results

  // Slow-changing data - longer TTL
  USER_PROFILE: 1800,           // 30 min - user profiles
  PORTFOLIO_PROJECTS: 1800,     // 30 min - portfolio
  PACKAGES: 3600,               // 1 hour - service packages
  AVAILABILITY: 1800,           // 30 min - availability slots

  // Admin/Reporting - medium TTL
  ADMIN_STATS: 600,             // 10 min - admin statistics
  REPORTS: 600,                 // 10 min - reports
};

// Database Query Optimization Presets
const QUERY_SELECT = {
  // Minimal user info - list views
  USER_MINIMAL: {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    city: true,
    avatarUrl: true,
  },

  // Full user info - detail views
  USER_FULL: {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    city: true,
    avatarUrl: true,
    bio: true,
    createdAt: true,
  },

  // Minimal professional info
  PROFESSIONAL_MINIMAL: {
    id: true,
    userId: true,
    hourlyRate: true,
    trialEndsAt: true,
    rating: true,
    totalBookings: true,
    totalReviews: true,
  },

  // Professional for list display
  PROFESSIONAL_LIST: {
    id: true,
    userId: true,
    specialization: true,
    hourlyRate: true,
    rating: true,
    totalBookings: true,
    totalReviews: true,
    user: { select: this.USER_MINIMAL },
  },

  // Project minimal for lists
  PROJECT_MINIMAL: {
    id: true,
    title: true,
    description: true,
    budget: true,
    status: true,
    city: true,
    createdAt: true,
    clientId: true,
  },

  // Quote minimal for lists
  QUOTE_MINIMAL: {
    id: true,
    projectId: true,
    professionalId: true,
    amount: true,
    status: true,
    version: true,
    createdAt: true,
  },
};

// Lazy Loading Strategy: return only essential fields, load relationships on demand
const LAZY_LOADING = {
  // Projects: GET /api/projects (list) - no relations by default
  LIST_ONLY: {
    id: true,
    title: true,
    description: true,
    budget: true,
    status: true,
    city: true,
    createdAt: true,
  },

  // Projects: GET /api/projects/:id (detail) - full relations
  DETAIL_FULL: true, // Load all relations

  // Professionals: GET /api/professionals (list) - user only
  LIST_NO_RELATIONS: {
    include: {
      user: { select: this.USER_MINIMAL },
    },
  },

  // Professionals: GET /api/professionals/:id (detail) - all relations
  DETAIL_WITH_RELATIONS: {
    include: {
      user: true,
      quotes: { select: this.QUOTE_MINIMAL },
      portfolio: true,
      followers: true,
      badges: true,
    },
  },
};

// Compression Configuration
const COMPRESSION_CONFIG = {
  ENABLED: process.env.COMPRESSION_ENABLED !== 'false',
  LEVEL: 6, // 1-9, default 6 is good balance
  THRESHOLD: 1024, // Only compress responses > 1KB
  TYPE: ['application/json', 'text/html', 'text/css', 'text/javascript'],
};

// Brotli Compression (for text-heavy responses)
const BROTLI_CONFIG = {
  ENABLED: process.env.BROTLI_ENABLED === 'true',
  QUALITY: 4, // 0-11, lower = faster, higher = smaller
};

// Query Batching: How many queries can be batched together
const QUERY_BATCHING = {
  MAX_BATCH_SIZE: 50,
  TIMEOUT_MS: 100, // Wait up to 100ms to accumulate queries
};

// Cache Key Generation Strategy
function generateCacheKey(prefix, userId, resourceId, queryParams = {}) {
  const userPart = userId ? `:user:${userId}` : '';
  const resourcePart = resourceId ? `:${resourceId}` : '';
  const queryPart = Object.keys(queryParams).length > 0
    ? `:${JSON.stringify(queryParams)}`
    : '';

  return `${prefix}${userPart}${resourcePart}${queryPart}`;
}

// Dashboard KPI Endpoints: Group 9 separate queries into 1
const DASHBOARD_KPI_QUERIES = {
  // Admin Dashboard KPIs - All in 1 query
  ENDPOINT: 'GET /api/admin/dashboard/kpis',
  TTL: CACHE_TTL.DASHBOARD_KPI,
  QUERIES: [
    'totalUsers',        // Count all users
    'totalProfessionals', // Count professionals
    'totalProjects',      // Count projects
    'totalBookings',      // Count bookings
    'totalRevenue',       // Sum of payments
    'activeSubscriptions', // Count active subscriptions
    'pendingPayments',    // Count pending payments
    'disputesOpen',       // Count open disputes
    'recentSignups',      // Last 7 days signups
  ],
};

// Full-Page Cache: Group multiple endpoints for dashboard
const FULL_PAGE_CACHE = {
  ADMIN_DASHBOARD: {
    TTL: 300, // 5 minutes
    ENDPOINTS: [
      '/api/admin/dashboard/kpis',
      '/api/admin/stats/revenue',
      '/api/admin/stats/subscriptions',
    ],
  },
  PROFESSIONAL_PROFILE: {
    TTL: 600, // 10 minutes
    ENDPOINTS: [
      '/api/professionals/:id',
      '/api/professionals/:id/portfolio',
      '/api/professionals/:id/reviews',
    ],
  },
};

// CDN Caching Strategy
const CDN_CACHE = {
  // Static assets - long TTL
  IMAGES: {
    TTL: 31536000, // 1 year
    HEADERS: { 'Cache-Control': 'public, max-age=31536000, immutable' },
  },

  // Profile images - medium TTL with versioning
  AVATARS: {
    TTL: 2592000, // 30 days
    HEADERS: { 'Cache-Control': 'public, max-age=2592000' },
    VERSION_BUST: true, // Use content hash for cache busting
  },

  // Portfolio images - medium TTL
  PORTFOLIO: {
    TTL: 2592000, // 30 days
    HEADERS: { 'Cache-Control': 'public, max-age=2592000' },
  },

  // Project images - short TTL (can change)
  PROJECT_PHOTOS: {
    TTL: 604800, // 7 days
    HEADERS: { 'Cache-Control': 'public, max-age=604800' },
  },
};

module.exports = {
  CACHE_TTL,
  QUERY_SELECT,
  LAZY_LOADING,
  COMPRESSION_CONFIG,
  BROTLI_CONFIG,
  QUERY_BATCHING,
  generateCacheKey,
  DASHBOARD_KPI_QUERIES,
  FULL_PAGE_CACHE,
  CDN_CACHE,
};

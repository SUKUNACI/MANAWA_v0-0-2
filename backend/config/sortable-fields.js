/**
 * Sortable Fields Configuration
 * Whitelist of sortable fields by route/endpoint
 * Q64 Implementation
 */

const SORTABLE_FIELDS = {
  // Projects routes
  'GET /projects': ['id', 'title', 'createdAt', 'updatedAt', 'budget', 'status', 'city'],
  'GET /projects/mine': ['id', 'title', 'createdAt', 'updatedAt', 'budget', 'status'],
  'GET /projects/:id': [],  // Detail endpoint - no sorting needed

  // Quotes routes
  'GET /quotes': ['id', 'version', 'createdAt', 'updatedAt', 'status'],
  'GET /quotes/received': ['id', 'version', 'createdAt', 'updatedAt', 'status'],
  'GET /admin/quotes': ['id', 'version', 'createdAt', 'updatedAt', 'status'],

  // Users routes
  'GET /users': ['id', 'createdAt', 'updatedAt', 'email'],
  'GET /admin/users': ['id', 'createdAt', 'updatedAt', 'email'],

  // Analytics routes
  'GET /analytics/professionals': ['id', 'createdAt', 'updatedAt', 'email', 'rating'],
  'GET /analytics/clients': ['id', 'createdAt', 'updatedAt', 'email'],
  'GET /admin/analytics/dashboard': [],  // Dashboard - no sorting

  // KPIs routes
  'GET /kpis/dashboard': [],  // Dashboard - no sorting
  'GET /kpis/admin/dashboard': [],  // Admin dashboard - no sorting

  // Payments routes
  'GET /payments': ['id', 'createdAt', 'updatedAt', 'status', 'amount'],
  'GET /payments/retry': ['id', 'createdAt', 'updatedAt', 'status'],
  'GET /admin/payments': ['id', 'createdAt', 'updatedAt', 'status', 'amount'],

  // Notifications routes
  'GET /notifications': ['id', 'createdAt', 'updatedAt', 'status'],
  'GET /admin/notifications': ['id', 'createdAt', 'updatedAt', 'status'],

  // Notification Templates routes
  'GET /notification-templates': ['id', 'createdAt', 'updatedAt', 'name'],
  'GET /admin/notification-templates': ['id', 'createdAt', 'updatedAt', 'name'],

  // Notification Preferences routes
  'GET /notification-preferences': ['id', 'createdAt', 'updatedAt'],
  'GET /admin/notification-preferences': ['id', 'createdAt', 'updatedAt'],

  // Subscriptions routes
  'GET /subscriptions': ['id', 'createdAt', 'updatedAt', 'status'],
  'GET /admin/subscriptions': ['id', 'createdAt', 'updatedAt', 'status'],

  // Support routes
  'GET /support': ['id', 'createdAt', 'updatedAt', 'status'],
  'GET /admin/support': ['id', 'createdAt', 'updatedAt', 'status'],

  // Search routes
  'GET /search/projects': ['id', 'title', 'createdAt', 'updatedAt', 'budget', 'city'],
  'GET /search/professionals': ['id', 'createdAt', 'updatedAt', 'email', 'rating'],

  // Portfolio Projects routes
  'GET /portfolio-projects': ['id', 'createdAt', 'updatedAt', 'title'],
  'GET /admin/portfolio-projects': ['id', 'createdAt', 'updatedAt', 'title'],

  // Referrals routes
  'GET /referrals': ['id', 'createdAt', 'updatedAt', 'status'],
  'GET /admin/referrals': ['id', 'createdAt', 'updatedAt', 'status'],

  // Messages routes
  'GET /messages': ['id', 'createdAt', 'updatedAt'],
  'GET /admin/messages': ['id', 'createdAt', 'updatedAt'],

  // Disputes routes
  'GET /disputes': ['id', 'createdAt', 'updatedAt', 'status'],
  'GET /admin/disputes': ['id', 'createdAt', 'updatedAt', 'status'],

  // Reviews routes
  'GET /reviews': ['id', 'createdAt', 'updatedAt', 'rating'],
  'GET /admin/reviews': ['id', 'createdAt', 'updatedAt', 'rating'],

  // Backups routes
  'GET /admin/backups': ['id', 'createdAt', 'updatedAt'],

  // CDN routes
  'GET /admin/cdn': ['id', 'createdAt', 'updatedAt', 'name'],

  // Monitoring routes
  'GET /monitoring': ['id', 'createdAt', 'updatedAt'],
  'GET /admin/monitoring': ['id', 'createdAt', 'updatedAt'],

  // Role Permissions routes
  'GET /role-permissions': ['id', 'createdAt', 'updatedAt'],
  'GET /admin/role-permissions': ['id', 'createdAt', 'updatedAt'],

  // Verification routes
  'GET /verification': ['id', 'createdAt', 'updatedAt', 'status'],
  'GET /admin/verification': ['id', 'createdAt', 'updatedAt', 'status'],

  // Video Calls routes
  'GET /video-calls': ['id', 'createdAt', 'updatedAt', 'status'],
  'GET /admin/video-calls': ['id', 'createdAt', 'updatedAt', 'status'],

  // Webhooks routes
  'GET /admin/webhooks': ['id', 'createdAt', 'updatedAt', 'status'],

  // Bookings routes
  'GET /bookings': ['id', 'createdAt', 'updatedAt', 'status'],

  // Badges routes
  'GET /badges': ['id', 'createdAt', 'updatedAt', 'name'],

  // Companies routes
  'GET /companies': ['id', 'createdAt', 'updatedAt', 'name'],

  // Finances routes
  'GET /finances': ['id', 'createdAt', 'updatedAt'],

  // Queues routes
  'GET /admin/queues': ['id', 'createdAt', 'updatedAt', 'status'],
};

/**
 * Get allowed sortable fields for a route
 * @param {string} route - Route path (e.g., 'GET /projects')
 * @returns {array} Array of sortable field names
 */
function getSortableFields(route) {
  return SORTABLE_FIELDS[route] || [];
}

module.exports = {
  SORTABLE_FIELDS,
  getSortableFields,
};

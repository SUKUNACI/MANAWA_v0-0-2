/**
 * Admin Routes
 * Main router for admin endpoints including bulk operations
 */

const express = require('express');
const bulkOperationsRoutes = require('./bulk-operations');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ============ ADMIN AUTHENTICATION ============

// All admin routes require admin role
router.use(requireAuth, requireRole('ADMIN'));

// ============ BULK OPERATIONS ============

// Mount bulk operations routes under /projects/bulk
router.use('/projects/bulk', bulkOperationsRoutes);

// ============ PLACEHOLDER FOR OTHER ADMIN ROUTES ============

/**
 * GET /api/v1/admin
 * Admin dashboard info
 */
router.get('/', (req, res) => {
  res.json({
    message: 'Admin API',
    version: 'v1',
    endpoints: {
      bulk_create: 'POST /admin/projects/bulk',
      bulk_update: 'PATCH /admin/projects/bulk',
      bulk_delete: 'DELETE /admin/projects/bulk',
    },
  });
});

module.exports = router;

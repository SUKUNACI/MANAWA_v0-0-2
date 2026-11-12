/**
 * Documentation Routes
 * Serves Swagger UI and OpenAPI specifications
 *
 * Endpoints:
 * GET /docs - Interactive Swagger UI
 * GET /docs/swagger.json - OpenAPI specification in JSON
 * GET /docs/openapi.yaml - OpenAPI specification in YAML
 * GET /docs/health - Documentation endpoint health check
 */

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const router = express.Router();

try {
  // Load Swagger configuration
  const specs = require('../docs/swagger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');

  // Mount Swagger UI
  router.use('/', swaggerUi.serve, swaggerUi.setup(specs, {
    swaggerOptions: {
      persistAuthorization: true,
      displayOperationId: false,
      filter: true,
      showExtensions: false,
      deepLinking: true,
      presets: [
        swaggerUi.presets.apis,
        swaggerUi.SwaggerUIBundle.presets.SwaggerUIStandalonePreset,
      ],
      plugins: [
        swaggerUi.SwaggerUIBundle.plugins.DownloadUrl,
      ],
      layout: 'BaseLayout',
    },
    customCss: `
      .topbar { display: none; }
      .swagger-ui .topbar { background-color: #1e88e5; }
      .swagger-ui .info { margin-top: 0; }
    `,
    customSiteTitle: 'MANAWA API Documentation',
  }));

  // Serve JSON specification
  router.get('/swagger.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(specs);
  });

  // Serve OpenAPI specification in JSON format
  router.get('/openapi.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(specs);
  });

  // Serve YAML specification
  router.get('/openapi.yaml', (req, res) => {
    try {
      const yamlPath = path.join(__dirname, '../docs/openapi.yaml');
      const yamlContent = fs.readFileSync(yamlPath, 'utf8');
      res.setHeader('Content-Type', 'application/yaml');
      res.send(yamlContent);
    } catch (err) {
      res.status(500).json({
        error: 'Failed to load OpenAPI YAML specification',
        details: err.message,
      });
    }
  });

  // Health check for documentation endpoints
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      message: 'Documentation endpoints are operational',
      endpoints: {
        ui: '/docs',
        swagger_json: '/docs/swagger.json',
        openapi_json: '/docs/openapi.json',
        openapi_yaml: '/docs/openapi.yaml',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Redirect /api/docs to /docs for convenience
  router.get('/redirect', (req, res) => {
    res.redirect('/docs');
  });

  // API statistics
  router.get('/stats', (req, res) => {
    const stats = {
      title: 'MANAWA API Statistics',
      version: '1.0.0',
      totalEndpoints: 337,
      modules: [
        { name: 'Authentication', routes: 'auth.js', endpoints: 10 },
        { name: 'Users', routes: 'users.js', endpoints: 12 },
        { name: 'Verification', routes: 'verification.js', endpoints: 8 },
        { name: 'Professionals', routes: 'professionals.js', endpoints: 15 },
        { name: 'Projects', routes: 'projects.js', endpoints: 25 },
        { name: 'Quotes', routes: 'quotes.js', endpoints: 22 },
        { name: 'Bookings', routes: 'bookings.js', endpoints: 10 },
        { name: 'Payments', routes: 'payments.js', endpoints: 12 },
        { name: 'Finances', routes: 'finances.js', endpoints: 8 },
        { name: 'Messages', routes: 'messages.js', endpoints: 10 },
        { name: 'Notifications', routes: 'notifications.js', endpoints: 8 },
        { name: 'Reviews', routes: 'reviews.js', endpoints: 6 },
        { name: 'Subscriptions', routes: 'subscriptions.js', endpoints: 10 },
        { name: 'Portfolio', routes: 'portfolio-projects.js', endpoints: 8 },
        { name: 'Companies', routes: 'companies.js', endpoints: 6 },
        { name: 'Badges', routes: 'badges.js', endpoints: 5 },
        { name: 'Referrals', routes: 'referrals.js', endpoints: 8 },
        { name: 'Support', routes: 'support.js', endpoints: 7 },
        { name: 'Search', routes: 'search.js', endpoints: 12 },
        { name: 'Disputes', routes: 'disputes.js', endpoints: 8 },
        { name: 'Admin', routes: 'admin.js', endpoints: 25 },
        { name: 'Role Permissions', routes: 'role-permissions.js', endpoints: 15 },
        { name: 'Analytics', routes: 'analytics.js', endpoints: 18 },
        { name: 'Admin Backups', routes: 'admin-backups.js', endpoints: 12 },
        { name: 'Admin Recovery', routes: 'admin-recovery.js', endpoints: 10 },
        { name: 'CDN Admin', routes: 'cdn-admin.js', endpoints: 15 },
        { name: 'Video Calls', routes: 'videoCalls.js', endpoints: 12 },
        { name: 'Webhooks Admin', routes: 'webhooks-admin.js', endpoints: 14 },
        { name: 'Queues Admin', routes: 'queues-admin.js', endpoints: 12 },
        { name: 'Health', routes: 'health.js', endpoints: 5 },
        { name: 'Monitoring', routes: 'monitoring.js', endpoints: 8 },
      ],
      securitySchemes: ['JWT Bearer Token'],
      rateLimiting: {
        authLimiter: '10 requests per 15 minutes per IP',
        readLimiter: '30 requests per 15 minutes per user',
        adminLimiter: '50 requests per 15 minutes per admin',
        writeLimiter: '20 requests per 15 minutes per user',
      },
      authentication: {
        accessTokenTTL: '15 minutes',
        refreshTokenTTL: '30 days',
        tokenType: 'JWT',
      },
      timestamp: new Date().toISOString(),
    };
    res.json(stats);
  });
} catch (err) {
  console.error('Error loading Swagger configuration:', err);
  router.get('/', (req, res) => {
    res.status(500).json({
      error: 'Documentation service unavailable',
      details: err.message,
    });
  });
}

module.exports = router;

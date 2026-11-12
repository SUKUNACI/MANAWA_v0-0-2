#!/usr/bin/env node

/**
 * Script to update routes with Q63 + Q64 support
 * - Q63: Max page size (100 global, 500 admin)
 * - Q64: Sorting options (?sort= and ?order=)
 *
 * Usage: node update-routes-q63-q64.js
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, 'routes');
const ROUTES_TO_UPDATE = [
  'quotes.js',
  'users.js',
  'analytics.js',
  'kpis-admin.js',
  'payments.js',
  'payments-retry.js',
  'notifications.js',
  'notification-templates.js',
  'notification-preferences.js',
  'subscriptions.js',
  'support.js',
  'search.js',
  'portfolio-projects.js',
  'referrals.js',
  'referrals-admin.js',
  'messages.js',
  'disputes.js',
  'reviews.js',
  'admin-backups.js',
  'cdn-admin.js',
  'monitoring.js',
  'role-permissions.js',
  'verification.js',
  'videoCalls.js',
  'webhooks-admin.js',
  'bookings.js',
  'badges.js',
  'companies.js',
  'finances.js',
  'queues-admin.js',
];

function hasImports(content) {
  return content.includes("require('../utils/sorting-helper')")
    || content.includes("require('../config/sortable-fields')");
}

function addImports(content) {
  if (hasImports(content)) {
    return content;
  }

  // Find the logger require statement
  const loggerPattern = /const logger = require\('\.\.\/utils\/logger'\);/;

  if (!loggerPattern.test(content)) {
    console.warn('Could not find logger require statement');
    return content;
  }

  return content.replace(
    loggerPattern,
    `const logger = require('../utils/logger');
const { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');`
  );
}

function countGetRequests(content) {
  const matches = content.match(/router\.get\(/g);
  return matches ? matches.length : 0;
}

console.log('Q63 + Q64 Route Update Script');
console.log('=============================\n');

for (const routeFile of ROUTES_TO_UPDATE) {
  const filePath = path.join(ROUTES_DIR, routeFile);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ${routeFile}: File not found`);
    continue;
  }

  let content = fs.fs.readFileSync(filePath, 'utf8');
  const getCount = countGetRequests(content);

  if (getCount === 0) {
    console.log(`⏭️  ${routeFile}: No GET routes found`);
    continue;
  }

  // Add imports if needed
  const hasImports = content.includes("require('../utils/sorting-helper')");
  if (!hasImports) {
    content = addImports(content);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ ${routeFile}: Added imports (${getCount} GET routes)`);
  } else {
    console.log(`✓ ${routeFile}: Already updated (${getCount} GET routes)`);
  }
}

console.log('\n=============================');
console.log('Manual steps for each route:');
console.log('1. Add validation queries: sort, order');
console.log('2. Use buildPaginationQuery() instead of manual limit/page');
console.log('3. Replace orderBy: { createdAt: \'desc\' } with ...paginationQuery');
console.log('\nExample:');
console.log(`
  const paginationQuery = buildPaginationQuery({
    page: req.query.page,
    limit: req.query.limit,
    isAdmin: req.user?.role === 'ADMIN',
    sortParam: req.query.sort,
    orderParam: req.query.order,
    allowedFields: getSortableFields('GET /route-name'),
    defaultOrder: { createdAt: 'desc' },
  });

  const data = await prisma.model.findMany({
    where: { ... },
    ...paginationQuery,
  });
`);

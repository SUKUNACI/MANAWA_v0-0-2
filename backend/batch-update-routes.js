#!/usr/bin/env node

/**
 * Batch Update Routes - Add Q63 + Q64 imports to all routes
 * Usage: node batch-update-routes.js
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, 'routes');

// Routes already updated manually
const ALREADY_UPDATED = [
  'projects.js',
  'quotes.js',
  'users.js',
  'analytics.js',
  'payments.js',
  'notifications.js',
];

function addImportsToFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Check if already has imports
  if (content.includes("require('../utils/sorting-helper')")) {
    return false; // Already updated
  }

  // Find the best place to add imports - after logger or other utils
  const loggerMatch = content.match(/const logger = require\('\.\.\/utils\/logger'\);/);
  const lastUtilsMatch = content.match(/(const \w+ = require\('\.\.\/[^']+'\);)(?![\s\S]*const \w+ = require\('\.\.\/[^']+'\);)/);

  if (!loggerMatch && !lastUtilsMatch) {
    console.warn(`  ⚠️  Could not find insertion point in ${path.basename(filePath)}`);
    return false;
  }

  const insertPoint = loggerMatch ? loggerMatch[0] : lastUtilsMatch[1];

  const newImports = `\nconst { buildPaginationQuery } = require('../utils/sorting-helper');
const { getSortableFields } = require('../config/sortable-fields');`;

  content = content.replace(insertPoint, insertPoint + newImports);

  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

function getRoutesNeedingUpdate() {
  const routesDir = ROUTES_DIR;
  const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
  return files.filter(f => !ALREADY_UPDATED.includes(f));
}

console.log('Batch Update Routes - Adding Q63 + Q64 Imports');
console.log('==============================================\n');

const routesNeedingUpdate = getRoutesNeedingUpdate();
console.log(`Found ${routesNeedingUpdate.length} routes needing update\n`);

let updated = 0;
let skipped = 0;
let failed = 0;

for (const routeFile of routesNeedingUpdate) {
  const filePath = path.join(ROUTES_DIR, routeFile);

  if (!fs.existsSync(filePath)) {
    console.log(`✗ ${routeFile}: File not found`);
    failed++;
    continue;
  }

  try {
    const success = addImportsToFile(filePath);
    if (success) {
      console.log(`✅ ${routeFile}: Added imports`);
      updated++;
    } else {
      console.log(`⏭️  ${routeFile}: Already updated or no insertion point found`);
      skipped++;
    }
  } catch (error) {
    console.log(`❌ ${routeFile}: Error - ${error.message}`);
    failed++;
  }
}

console.log('\n==============================================');
console.log(`Summary:`);
console.log(`  ✅ Updated: ${updated}`);
console.log(`  ⏭️  Skipped: ${skipped}`);
console.log(`  ❌ Failed: ${failed}`);
console.log(`\nNext steps:`);
console.log('1. Review each route\'s GET endpoints');
console.log('2. Add sort and order query validators to GET endpoints');
console.log('3. Replace manual pagination with buildPaginationQuery()');
console.log('4. Test with: npm test -- tests/q63-q64.test.js');

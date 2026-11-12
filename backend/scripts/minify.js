#!/usr/bin/env node

/**
 * OPTIMIZATION #39: Asset Minification Script
 *
 * Minifies JavaScript files in:
 * - Backend logs and utilities
 * - Admin panel JS
 *
 * Usage:
 *   npm run minify
 *
 * This reduces file sizes by 50-70% and improves transfer speed
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// Try to require terser for minification
let terser;
try {
  terser = require('terser');
} catch (err) {
  console.warn('[Minify] Terser not installed. Install with: npm install --save-dev terser');
  console.warn('[Minify] Continuing without minification...\n');
  terser = null;
}

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const stat = promisify(fs.stat);

// Files to minify
const FILES_TO_MINIFY = [
  // Admin panel utilities
  'public/admin/js/*.js',
  'public/admin/admin-utils.js',
  'public/admin/dashboard.js',
  'public/admin/form-handler.js',

  // Utility files (optional, if exposed)
  'utils/logger.js',
  'utils/validation.js',
];

// Minification options
const TERSER_OPTIONS = {
  compress: {
    drop_console: false, // Keep console for debugging
    passes: 2,
    pure_funcs: ['console.debug'], // Remove debug calls
  },
  mangle: {
    toplevel: false, // Don't mangle top-level names for Node.js
    keep_fnames: true, // Keep function names for debugging
  },
  output: {
    comments: false, // Remove all comments
  },
};

/**
 * Get file size in KB
 */
function getFileSizeKB(sizeBytes) {
  return (sizeBytes / 1024).toFixed(2);
}

/**
 * Minify a single JavaScript file
 */
async function minifyFile(inputPath) {
  if (!terser) {
    console.log(`[Skip] ${inputPath} (terser not installed)`);
    return;
  }

  try {
    // Read original file
    const code = await readFile(inputPath, 'utf-8');
    const originalSize = code.length;

    // Minify with terser
    const result = await terser.minify(code, TERSER_OPTIONS);

    if (result.error) {
      console.error(`[Error] ${inputPath}: ${result.error.message}`);
      return;
    }

    const minifiedCode = result.code;
    const minifiedSize = minifiedCode.length;
    const savedBytes = originalSize - minifiedSize;
    const savedPercent = ((savedBytes / originalSize) * 100).toFixed(1);

    // Write minified file (replace original or create .min.js)
    const outputPath = inputPath.replace(/\.js$/, '.min.js');
    await writeFile(outputPath, minifiedCode, 'utf-8');

    console.log(`[✓] ${inputPath}`);
    console.log(`    Original: ${getFileSizeKB(originalSize)} KB`);
    console.log(`    Minified: ${getFileSizeKB(minifiedSize)} KB`);
    console.log(`    Saved: ${getFileSizeKB(savedBytes)} KB (${savedPercent}%)\n`);

    return { inputPath, outputPath, savedBytes };
  } catch (err) {
    console.error(`[Error] Failed to minify ${inputPath}:`, err.message);
  }
}

/**
 * Find files matching glob patterns
 */
async function findFiles(pattern) {
  const glob = require('glob').glob;
  try {
    const files = await glob(pattern);
    return files;
  } catch (err) {
    console.warn(`[Warn] Could not find files matching ${pattern}`);
    return [];
  }
}

/**
 * Main minification runner
 */
async function runMinification() {
  console.log('[Minify] Starting JavaScript minification...\n');

  if (!terser) {
    console.log('[Info] Terser not available. Skipping minification.\n');
    return;
  }

  let totalSaved = 0;
  const results = [];

  // Minify individual admin files directly
  const adminDir = path.join(__dirname, '../public/admin');
  if (fs.existsSync(adminDir)) {
    const adminFiles = fs.readdirSync(adminDir)
      .filter(f => f.endsWith('.js') && !f.endsWith('.min.js'))
      .map(f => path.join(adminDir, f));

    for (const file of adminFiles) {
      const result = await minifyFile(file);
      if (result) {
        results.push(result);
        totalSaved += result.savedBytes;
      }
    }
  }

  // Summary
  console.log('\n[Summary]');
  console.log(`Files processed: ${results.length}`);
  console.log(`Total size saved: ${getFileSizeKB(totalSaved)} KB\n`);

  if (results.length === 0) {
    console.log('[Info] No JavaScript files found to minify.');
    console.log('[Info] Create admin panel JS files to enable minification.\n');
  }
}

// Run minification
runMinification().catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});

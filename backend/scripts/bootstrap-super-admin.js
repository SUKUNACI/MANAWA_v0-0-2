#!/usr/bin/env node

/**
 * Bootstrap Super Administrator — MANAWA
 *
 * Creates the first SUPER admin account in a fresh Neon database.
 * This script is designed to run ONCE after the baseline 0_init migration is applied.
 *
 * Usage:
 *   npm run bootstrap:super-admin
 *   # or
 *   node scripts/bootstrap-super-admin.js
 *
 * Requirements:
 * - DATABASE_URL environment variable set (Neon connection)
 * - Baseline 0_init migration applied
 * - User table empty (count = 0)
 * - Prisma 5.22.0+ installed
 * - bcryptjs 2.4.3+ installed
 */

const readline = require('readline');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

// Utility: Print with color
const log = (message, color = 'reset') => {
  console.log(`${colors[color]}${message}${colors.reset}`);
};

// Utility: Create readline interface
const createInterface = () => readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Utility: Question with optional default
const question = (rl, prompt, defaultValue = '') => {
  return new Promise((resolve) => {
    const displayPrompt = defaultValue
      ? `${colors.cyan}${prompt} [${defaultValue}]: ${colors.reset}`
      : `${colors.cyan}${prompt}: ${colors.reset}`;

    rl.question(displayPrompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
};

// Step 1: Verify DATABASE_URL and Neon production environment
async function verifyDatabaseUrl() {
  log('\n📋 Step 1: Verifying database connection...', 'cyan');

  if (!process.env.DATABASE_URL) {
    log('❌ ERROR: DATABASE_URL environment variable not set', 'red');
    process.exit(1);
  }

  // Parse connection details safely (without exposing password)
  const urlObj = new URL(process.env.DATABASE_URL);
  const dbName = urlObj.pathname.replace('/', '');
  const host = urlObj.hostname;

  log(`✓ Database: ${dbName}`, 'green');
  log(`✓ Host: ${host}`, 'green');

  // Verify Neon endpoint and production environment
  const expectedHostPrefix = 'ep-dry-rain-bj6h5mr3';
  const expectedDatabase = 'neondb';

  if (!host.startsWith(expectedHostPrefix)) {
    log(``, 'reset');
    log(`⚠️  WARNING: Unexpected hostname`, 'yellow');
    log(`   Expected to start with: ${expectedHostPrefix}`, 'yellow');
    log(`   Got:      ${host}`, 'yellow');
    log(``, 'reset');
    log(`⚠️  IMPORTANT: Verify in Neon Dashboard before proceeding:`, 'yellow');
    log(`   - Confirm endpoint starts with: ${expectedHostPrefix}`, 'yellow');
    log(`   - Confirm project: MANAWA_v0-0-2`, 'yellow');
    log(`   - Confirm branch: production`, 'yellow');
    log(``, 'reset');

    // Ask for confirmation
    const rl = createInterface();
    return new Promise((resolve) => {
      rl.question('Continue? (type "yes" to confirm): ', (answer) => {
        rl.close();
        if (answer !== 'yes') {
          log('❌ Bootstrap cancelled by user', 'red');
          process.exit(1);
        }
        resolve(true);
      });
    });
  }

  if (dbName !== expectedDatabase) {
    log(`❌ ERROR: Unexpected database name: ${dbName}`, 'red');
    log(`   Expected: ${expectedDatabase}`, 'red');
    process.exit(1);
  }

  // Attempt connection
  try {
    const result = await prisma.$queryRaw`SELECT NOW()`;
    log('✓ Connection successful', 'green');
    return true;
  } catch (err) {
    log(`❌ Connection failed: ${err.message}`, 'red');
    process.exit(1);
  }
}

// Step 2: Verify User table and baseline 0_init migration
async function verifyMigrations() {
  log('\n📋 Step 2: Verifying baseline 0_init...', 'cyan');

  // Required baseline migration
  const REQUIRED_MIGRATIONS = [
    '0_init',
  ];

  try {
    // Check if _prisma_migrations table exists and get all migrations
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
      ORDER BY started_at ASC
    `;

    if (!migrations || migrations.length === 0) {
      log('❌ No migrations found. Apply migrations first:', 'red');
      log('   cd backend && npx prisma migrate deploy', 'yellow');
      process.exit(1);
    }

    // Group migrations by name, keeping latest attempt for each migration
    const latestByName = {};
    migrations.forEach(m => {
      if (!latestByName[m.migration_name]) {
        latestByName[m.migration_name] = m;
      } else {
        // Keep the latest attempt (by started_at)
        const current = latestByName[m.migration_name];
        // Note: started_at not in SELECT, use finished_at as proxy
        // If both have finished_at, keep the later one
        if (m.finished_at && current.finished_at) {
          if (new Date(m.finished_at) > new Date(current.finished_at)) {
            latestByName[m.migration_name] = m;
          }
        } else if (m.finished_at && !current.finished_at) {
          latestByName[m.migration_name] = m;
        }
      }
    });

    // Check each required migration
    const failedMigrations = [];
    const incompleteMigrations = [];

    REQUIRED_MIGRATIONS.forEach(requiredName => {
      const latest = latestByName[requiredName];
      if (!latest) {
        // Migration not found at all
        failedMigrations.push({ migration_name: requiredName, reason: 'MISSING' });
      } else if (latest.finished_at === null) {
        // Latest attempt is incomplete
        incompleteMigrations.push(latest);
      } else if (latest.rolled_back_at !== null) {
        // Latest attempt was rolled back
        failedMigrations.push(latest);
      }
      // If latest attempt has finished_at != null AND rolled_back_at === null, it succeeded
    });

    // Report failed migrations (including missing)
    if (failedMigrations.length > 0) {
      log('❌ ERROR: Some required migrations have failed or are missing:', 'red');
      failedMigrations.forEach(m => {
        const reason = m.reason === 'MISSING' ? ' (not found)' : ' (rolled back)';
        log(`   - ${m.migration_name}${reason}`, 'red');
      });
      process.exit(1);
    }

    // Report incomplete migrations
    if (incompleteMigrations.length > 0) {
      log('❌ ERROR: Some migrations are incomplete:', 'red');
      incompleteMigrations.forEach(m => {
        log(`   - ${m.migration_name}`, 'red');
      });
      process.exit(1);
    }

    // All required migrations have succeeded
    log(`✓ Baseline 0_init migration applied`, 'green');

    // Check User table structure
    const userTableInfo = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'User'
      ORDER BY ordinal_position
      LIMIT 50
    `;

    if (!userTableInfo || userTableInfo.length === 0) {
      log('❌ User table not found. Run migrations first.', 'red');
      process.exit(1);
    }

    log(`✓ User table exists with ${userTableInfo.length} columns`, 'green');

  } catch (err) {
    log(`❌ Migration verification failed: ${err.message}`, 'red');
    process.exit(1);
  }
}

// Step 3: Verify User count is 0
async function verifyUserCount() {
  log('\n📋 Step 3: Verifying database is empty...', 'cyan');

  try {
    const count = await prisma.user.count();

    if (count > 0) {
      log(`❌ ERROR: Database already contains ${count} user(s)`, 'red');
      log('   Bootstrap only valid on empty database', 'red');
      process.exit(1);
    }

    log('✓ User table is empty', 'green');
    return true;
  } catch (err) {
    log(`❌ Count check failed: ${err.message}`, 'red');
    process.exit(1);
  }
}

// Step 4: Gather user input (email, firstName, lastName, password with masking)
async function gatherInput() {
  log('\n📋 Step 4: Gathering information...', 'cyan');

  const rl = createInterface();

  // Email
  const email = await question(
    rl,
    'Email address',
    'super_admin@manawa.ci'
  );

  // Validate email format
  if (!email.includes('@')) {
    log('❌ ERROR: Invalid email format', 'red');
    rl.close();
    process.exit(1);
  }

  // First name
  const firstName = await question(
    rl,
    'First name',
    'Fondateur'
  );

  if (!firstName) {
    log('❌ ERROR: First name required', 'red');
    rl.close();
    process.exit(1);
  }

  // Last name
  const lastName = await question(
    rl,
    'Last name',
    'MANAWA'
  );

  if (!lastName) {
    log('❌ ERROR: Last name required', 'red');
    rl.close();
    process.exit(1);
  }

  rl.close();

  // Helper function: Get password with REAL masking via stdin raw mode
  const getPasswordWithMasking = (promptText) => {
    return new Promise((resolve) => {
      process.stdout.write(`${colors.cyan}${promptText}${colors.reset}`);

      let password = '';
      let isProcessing = false;

      const handleData = (chunk) => {
        if (isProcessing) return;
        isProcessing = true;

        try {
          for (let i = 0; i < chunk.length; i++) {
            const byte = chunk[i];
            const char = String.fromCharCode(byte);

            // Ctrl+C = 3
            if (byte === 3) {
              process.stdin.setRawMode(false);
              process.exit(0);
            }
            // Enter/Return = 13 or 10
            else if (byte === 13 || byte === 10) {
              process.stdin.removeListener('data', handleData);
              process.stdin.setRawMode(false);
              process.stdin.pause();
              process.stdout.write('\n');
              resolve(password);
              return;
            }
            // Backspace = 127 or 8
            else if (byte === 127 || byte === 8) {
              if (password.length > 0) {
                password = password.slice(0, -1);
                process.stdout.write('\b \b');
              }
            }
            // Printable characters (ASCII 32-126)
            else if (byte >= 32 && byte <= 126) {
              password += char;
              process.stdout.write('*');
            }
          }
        } finally {
          isProcessing = false;
        }
      };

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding(null);
      process.stdin.on('data', handleData);
    });
  };

  // Collect password (with REAL masking)
  const password1 = await getPasswordWithMasking('Password (minimum 15 characters): ');
  const password2 = await getPasswordWithMasking('Confirm password: ');

  // Validate password
  if (password1.length < 15) {
    log('❌ ERROR: Super admin password must be at least 15 characters', 'red');
    process.exit(1);
  }

  if (password1 !== password2) {
    log('❌ ERROR: Passwords do not match', 'red');
    process.exit(1);
  }

  if (password1 === email) {
    log('❌ ERROR: Password cannot be the same as email', 'red');
    process.exit(1);
  }

  log('✓ Inputs validated', 'green');

  return {
    email: email.toLowerCase().trim(),
    firstName,
    lastName,
    password: password1,
  };
}

// Step 5: Verify email uniqueness (case-insensitive)
async function verifyEmailUnique(email) {
  log('\n📋 Step 5: Verifying email uniqueness...', 'cyan');

  try {
    const existing = await prisma.user.findMany({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });

    if (existing.length > 0) {
      log(`❌ ERROR: Email "${email}" already exists`, 'red');
      process.exit(1);
    }

    log('✓ Email is unique', 'green');
    return true;
  } catch (err) {
    log(`❌ Email verification failed: ${err.message}`, 'red');
    process.exit(1);
  }
}

// Step 6: Hash password
async function hashPassword(password) {
  log('\n📋 Step 6: Hashing password...', 'cyan');

  try {
    const hash = await bcrypt.hash(password, 10);
    log('✓ Password hashed securely', 'green');
    return hash;
  } catch (err) {
    log(`❌ Password hashing failed: ${err.message}`, 'red');
    process.exit(1);
  }
}

// Step 7: Create super admin user and audit log in SERIALIZABLE transaction
async function createSuperAdmin(data, passwordHash) {
  log('\n📋 Step 7: Creating super admin account...', 'cyan');

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Double-check: User count must still be 0
      const userCount = await tx.user.count();
      if (userCount > 0) {
        throw new Error('Database is no longer empty. Bootstrap aborted. This may indicate a concurrent bootstrap attempt.');
      }

      // Double-check: Email must still be unique
      const existing = await tx.user.findMany({
        where: {
          email: {
            equals: data.email,
            mode: 'insensitive',
          },
        },
      });

      if (existing.length > 0) {
        throw new Error(`Email "${data.email}" is no longer unique. This may indicate a concurrent bootstrap attempt.`);
      }

      // Create user
      const user = await tx.user.create({
        data: {
          id: crypto.randomUUID(),
          email: data.email,
          passwordHash: passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          role: 'ADMIN',
          adminLevel: 'SUPER',
          suspended: false,
          deletedAt: null,
          emailVerified: false,
          twoFAEnabled: false,
          mustChangePassword: false,
        },
      });

      // Create audit log entry with hash chain
      const previousHash = null; // No prior bootstrap entry
      const auditData = {
        action: 'BOOTSTRAP_SUPER_ADMIN',
        resourceType: 'USER',
        resourceId: user.id,
        userId: null, // Pre-auth bootstrap
        metadata: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          adminLevel: user.adminLevel,
        },
      };

      const currentHashInput = JSON.stringify(auditData);
      const currentHash = crypto
        .createHash('sha256')
        .update(currentHashInput)
        .digest('hex');

      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          action: auditData.action,
          resourceType: auditData.resourceType,
          resourceId: auditData.resourceId,
          userId: null,
          metadata: auditData.metadata,
          previousHash: previousHash,
          currentHash: currentHash,
        },
      });

      return user;
    }, {
      isolationLevel: 'Serializable',
      timeout: 10000,
    });

    log(`✓ Super admin created successfully`, 'green');
    log(`   Email: ${result.email}`, 'green');
    log(`   Role: ${result.role}`, 'green');
    log(`   Admin Level: ${result.adminLevel}`, 'green');

    return result;
  } catch (err) {
    log(`❌ Account creation failed: ${err.message}`, 'red');
    process.exit(1);
  }
}

// Step 8: Verify account creation
async function verifyAccount(userId, email) {
  log('\n📋 Step 8: Verifying account creation...', 'cyan');

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      log('❌ ERROR: Account not found after creation', 'red');
      process.exit(1);
    }

    if (user.email !== email) {
      log('❌ ERROR: Email mismatch', 'red');
      process.exit(1);
    }

    if (user.adminLevel !== 'SUPER') {
      log('❌ ERROR: Admin level not set to SUPER', 'red');
      process.exit(1);
    }

    // Check audit log
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: 'BOOTSTRAP_SUPER_ADMIN',
        resourceId: userId,
      },
    });

    if (!auditLog) {
      log('❌ ERROR: Audit log not found', 'red');
      process.exit(1);
    }

    log('✓ Account verified', 'green');
    log('✓ Audit log created', 'green');

    return true;
  } catch (err) {
    log(`❌ Verification failed: ${err.message}`, 'red');
    process.exit(1);
  }
}

// Main execution
async function main() {
  log('\n╔════════════════════════════════════════════════════════╗', 'bright');
  log('║      MANAWA — Bootstrap Super Administrator         ║', 'bright');
  log('║                                                        ║', 'bright');
  log('║  This script creates the FIRST super admin account   ║', 'bright');
  log('║  in a fresh Neon database (empty User table).        ║', 'bright');
  log('╚════════════════════════════════════════════════════════╝', 'bright');

  try {
    // Execute bootstrap steps
    await verifyDatabaseUrl();
    await verifyMigrations();
    await verifyUserCount();
    const data = await gatherInput();
    await verifyEmailUnique(data.email);
    const passwordHash = await hashPassword(data.password);
    const user = await createSuperAdmin(data, passwordHash);
    await verifyAccount(user.id, data.email);

    log('\n╔════════════════════════════════════════════════════════╗', 'bright');
    log('║                                                        ║', 'bright');
    log('║  ✅  Bootstrap Complete!                             ║', 'green');
    log('║                                                        ║', 'bright');
    log('║  Super admin account is ready for login.             ║', 'bright');
    log('║                                                        ║', 'bright');
    log('║  RECOMMENDED NEXT STEPS:                             ║', 'bright');
    log('║  1. Change password after first login                ║', 'bright');
    log('║  2. Enable 2FA/TOTP                                  ║', 'bright');
    log('║  3. Configure account recovery settings              ║', 'bright');
    log('║                                                        ║', 'bright');
    log('╚════════════════════════════════════════════════════════╝', 'bright');

    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    log(`\n❌ FATAL ERROR: ${err.message}`, 'red');
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Run main
main();

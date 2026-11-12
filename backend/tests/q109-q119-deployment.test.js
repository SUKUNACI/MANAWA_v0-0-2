/**
 * Tests Q109-Q119: Deployment pipeline
 * Vérifie la configuration CI/CD, coverage gate, migration, timezone, graceful shutdown
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '../../');
const BACKEND     = path.join(__dirname, '../');
const INFRA       = path.join(ROOT, 'infrastructure');
const WORKFLOWS   = path.join(ROOT, '.github/workflows');

// ─── Q109: CI/CD pipeline ─────────────────────────────────────────────────────

describe('Q109: CI/CD pipeline', () => {
  it('ci.yml exists in .github/workflows', () => {
    expect(fs.existsSync(path.join(WORKFLOWS, 'ci.yml'))).toBe(true);
  });

  it('ci.yml triggers on push to main', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('branches: [main');
  });

  it('ci.yml triggers on pull_request', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('pull_request');
  });

  it('audit.yml also exists (dependency scanning)', () => {
    expect(fs.existsSync(path.join(WORKFLOWS, 'audit.yml'))).toBe(true);
  });
});

// ─── Q110: Automated testing in pipeline ──────────────────────────────────────

describe('Q110: Automated testing in pipeline', () => {
  it('ci.yml runs npm test', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('npm test');
  });

  it('ci.yml uses postgres service for integration tests', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('postgres:15');
  });

  it('ci.yml uses redis service', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('redis:7');
  });

  it('ci.yml uploads coverage artifact', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('coverage-report');
  });
});

// ─── Q111: Security scanning in pipeline ──────────────────────────────────────

describe('Q111: Security scanning in pipeline', () => {
  it('ci.yml has secrets-scan job', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('secrets-scan');
  });

  it('ci.yml uses gitleaks for secret detection', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('gitleaks');
  });

  it('ci.yml runs ESLint no-eval security rule', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('no-eval');
  });
});

// ─── Q112: Dependency scanning ────────────────────────────────────────────────

describe('Q112: Dependency scanning in pipeline', () => {
  it('audit.yml exists and runs npm audit', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'audit.yml'), 'utf8');
    expect(content).toContain('npm audit');
  });

  it('audit.yml generates SARIF report', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'audit.yml'), 'utf8');
    expect(content).toContain('sarif');
  });

  it('audit.yml fails on critical vulnerabilities', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'audit.yml'), 'utf8');
    expect(content).toContain('critical');
    expect(content).toContain('exit 1');
  });
});

// ─── Q113: Code coverage gate ─────────────────────────────────────────────────

describe('Q113: Code coverage gate', () => {
  it('jest.config.js has coverageThreshold set', () => {
    const config = require('../jest.config.js');
    expect(config.coverageThreshold).toBeDefined();
    expect(config.coverageThreshold.global).toBeDefined();
  });

  it('coverage gate is 80% for lines', () => {
    const config = require('../jest.config.js');
    expect(config.coverageThreshold.global.lines).toBe(80);
  });

  it('coverage gate is 80% for branches', () => {
    const config = require('../jest.config.js');
    expect(config.coverageThreshold.global.branches).toBe(80);
  });

  it('coverage gate is 80% for functions', () => {
    const config = require('../jest.config.js');
    expect(config.coverageThreshold.global.functions).toBe(80);
  });

  it('coverage gate is 80% for statements', () => {
    const config = require('../jest.config.js');
    expect(config.coverageThreshold.global.statements).toBe(80);
  });

  it('ci.yml enforces coverage gate step', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('coverage gate');
    expect(content).toContain('80');
  });
});

// ─── Q114: Performance regression testing ─────────────────────────────────────

describe('Q114: Performance regression testing', () => {
  it('ci.yml has performance job', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('performance');
  });

  it('performance threshold is 500ms', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('500');
  });

  it('performance test hits /api/v1/health', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('/api/v1/health');
  });

  it('performance test fails if 3+ runs exceed threshold', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('PERFORMANCE REGRESSION');
  });
});

// ─── Q115: Staging environment ────────────────────────────────────────────────

describe('Q115: Staging environment', () => {
  it('infrastructure/staging.md exists', () => {
    expect(fs.existsSync(path.join(INFRA, 'staging.md'))).toBe(true);
  });

  it('staging.md documents Render staging config', () => {
    const content = fs.readFileSync(path.join(INFRA, 'staging.md'), 'utf8');
    expect(content).toContain('manawa-api-staging');
  });

  it('staging.md lists required GitHub Secrets', () => {
    const content = fs.readFileSync(path.join(INFRA, 'staging.md'), 'utf8');
    expect(content).toContain('RENDER_DEPLOY_HOOK_STAGING');
    expect(content).toContain('STAGING_URL');
  });

  it('ci.yml has deploy-staging job', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('deploy-staging');
  });

  it('ci.yml runs staging smoke tests', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('smoke tests');
  });
});

// ─── Q116: Production environment ─────────────────────────────────────────────

describe('Q116: Production environment', () => {
  it('ci.yml has deploy-production job', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('deploy-production');
  });

  it('production deploy requires staging to pass first', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('needs: [deploy-staging]');
  });

  it('production deploy uses environment: production', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('environment: production');
  });

  it('infrastructure/DEPLOYMENT_GUIDE.md exists', () => {
    expect(fs.existsSync(path.join(INFRA, 'DEPLOYMENT_GUIDE.md'))).toBe(true);
  });
});

// ─── Q117: Zero-downtime deployment ───────────────────────────────────────────

describe('Q117: Zero-downtime deployment', () => {
  it('index.js has SIGTERM graceful shutdown handler', () => {
    const content = fs.readFileSync(path.join(BACKEND, 'index.js'), 'utf8');
    expect(content).toContain("process.on('SIGTERM'");
  });

  it('graceful shutdown calls server.close()', () => {
    const content = fs.readFileSync(path.join(BACKEND, 'index.js'), 'utf8');
    expect(content).toContain('server.close(');
  });

  it('graceful shutdown disconnects Redis', () => {
    const content = fs.readFileSync(path.join(BACKEND, 'index.js'), 'utf8');
    expect(content).toContain('redis.disconnect');
  });

  it('staging.md documents zero-downtime via Render rolling deploy', () => {
    const content = fs.readFileSync(path.join(INFRA, 'staging.md'), 'utf8');
    expect(content).toContain('rolling');
  });
});

// ─── Q118: Database migration strategy ────────────────────────────────────────

describe('Q118: Database migration strategy', () => {
  it('scripts/migrate-deploy.sh exists', () => {
    expect(fs.existsSync(path.join(BACKEND, 'scripts/migrate-deploy.sh'))).toBe(true);
  });

  it('migrate-deploy.sh uses prisma migrate deploy (not dev)', () => {
    const content = fs.readFileSync(path.join(BACKEND, 'scripts/migrate-deploy.sh'), 'utf8');
    expect(content).toContain('prisma migrate deploy');
    expect(content).not.toContain('prisma migrate dev');
  });

  it('migrate-deploy.sh generates prisma client', () => {
    const content = fs.readFileSync(path.join(BACKEND, 'scripts/migrate-deploy.sh'), 'utf8');
    expect(content).toContain('prisma generate');
  });

  it('migrate-deploy.sh checks DATABASE_URL is set', () => {
    const content = fs.readFileSync(path.join(BACKEND, 'scripts/migrate-deploy.sh'), 'utf8');
    expect(content).toContain('DATABASE_URL');
    expect(content).toContain('exit 1');
  });

  it('migrate-deploy.sh verifies DB connection', () => {
    const content = fs.readFileSync(path.join(BACKEND, 'scripts/migrate-deploy.sh'), 'utf8');
    expect(content).toContain('SELECT 1');
  });

  it('staging.md documents build command with migrate script', () => {
    const content = fs.readFileSync(path.join(INFRA, 'staging.md'), 'utf8');
    expect(content).toContain('migrate-deploy.sh');
  });
});

// ─── Q119: Rollback procedures ────────────────────────────────────────────────

describe('Q119: Rollback procedures', () => {
  it('scripts/rollback-trigger.sh exists', () => {
    expect(fs.existsSync(path.join(BACKEND, 'scripts/rollback-trigger.sh'))).toBe(true);
  });

  it('ci.yml has auto-rollback step on production failure', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('Auto-rollback');
    expect(content).toContain('RENDER_DEPLOY_HOOK_PREV');
  });

  it('auto-rollback triggers on failure condition', () => {
    const content = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    expect(content).toContain('if: failure()');
  });

  it('staging.md documents manual rollback commands', () => {
    const content = fs.readFileSync(path.join(INFRA, 'staging.md'), 'utf8');
    expect(content).toContain('git revert HEAD');
    expect(content).toContain('rollback-trigger.sh');
  });

  it('staging.md documents DB migration rollback', () => {
    const content = fs.readFileSync(path.join(INFRA, 'staging.md'), 'utf8');
    expect(content).toContain('prisma migrate resolve');
  });
});

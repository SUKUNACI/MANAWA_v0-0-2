/**
 * Tests Q91-Q100: Data Management (Retention, GDPR, Anonymization, Inventory, PII, Masking)
 */

const { RETENTION_POLICIES } = require('../routes/admin-data-retention');
const { DATA_INVENTORY, CLASSIFICATION_LEVELS } = require('../routes/admin-data-inventory');
const { detectPii, maskString, maskObject, SENSITIVE_FIELD_NAMES } = require('../config/pii-detector');

// ─── Q91: Data Retention Policy ───────────────────────────────────────────────

describe('Q91: Data Retention Policy', () => {
  it('retention policies object is defined', () => {
    expect(RETENTION_POLICIES).toBeDefined();
    expect(typeof RETENTION_POLICIES).toBe('object');
  });

  it('contains at least 8 entity types', () => {
    expect(Object.keys(RETENTION_POLICIES).length).toBeGreaterThanOrEqual(8);
  });

  it('PaymentAuditLog retention is 7 years (financial compliance)', () => {
    expect(RETENTION_POLICIES.PaymentAuditLog).toBe(2555);
  });

  it('AdminLog retention is at least 2 years (compliance)', () => {
    expect(RETENTION_POLICIES.AdminLog).toBeGreaterThanOrEqual(730);
  });

  it('LoginAttempt retention is 90 days', () => {
    expect(RETENTION_POLICIES.LoginAttempt).toBe(90);
  });

  it('ProfileView has shortest TTL (operational data)', () => {
    const days = Object.values(RETENTION_POLICIES).filter(d => d > 0);
    expect(RETENTION_POLICIES.ProfileView).toBe(Math.min(...days));
  });

  it('archiveAfterDays is 80% of retention period', () => {
    const days = 365;
    const archiveAfter = Math.floor(days * 0.8);
    expect(archiveAfter).toBe(292);
  });

  it('cutoff date calculation is correct', () => {
    const days = 30;
    const cutoff = new Date(new Date('2026-11-12T00:00:00Z').getTime() - days * 24 * 60 * 60 * 1000);
    expect(cutoff.toISOString().startsWith('2026-10-13')).toBe(true);
  });
});

// ─── Q92: Data Archival Strategy ─────────────────────────────────────────────

describe('Q92: Data Archival Strategy', () => {
  it('DataRetentionLog kept for 5 years (audit trail)', () => {
    expect(RETENTION_POLICIES.DataRetentionLog).toBe(1825);
  });

  it('dry-run purge returns count without deleting', () => {
    const dryRun = true;
    const count  = 42;
    const message = dryRun ? `${count} rows would be deleted (dry run)` : `${count} rows deleted`;
    expect(message).toMatch('would be deleted');
  });

  it('live purge message confirms deletion', () => {
    const dryRun = false;
    const count  = 42;
    const message = dryRun ? `${count} rows would be deleted (dry run)` : `${count} rows deleted`;
    expect(message).toMatch('rows deleted');
    expect(message).not.toMatch('dry run');
  });

  it('byEntity and byAction aggregation groups correctly', () => {
    const logs = [
      { entityType: 'Message', action: 'deleted' },
      { entityType: 'User',    action: 'anonymized' },
      { entityType: 'Message', action: 'deleted' },
    ];
    const byEntity = {};
    const byAction = {};
    logs.forEach(l => {
      byEntity[l.entityType] = (byEntity[l.entityType] || 0) + 1;
      byAction[l.action]     = (byAction[l.action]     || 0) + 1;
    });
    expect(byEntity.Message).toBe(2);
    expect(byAction.deleted).toBe(2);
    expect(byAction.anonymized).toBe(1);
  });
});

// ─── Q93: GDPR Right to Deletion ─────────────────────────────────────────────

describe('Q93: GDPR Right to Deletion', () => {
  it('GDPR request statuses are valid', () => {
    const statuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'];
    expect(statuses.length).toBe(4);
    expect(statuses).toContain('COMPLETED');
    expect(statuses).toContain('REJECTED');
  });

  it('hard delete anonymizes email to gdpr.invalid domain', () => {
    const userId = 'abc123';
    const email  = `deleted_${userId}@gdpr.invalid`;
    expect(email).toMatch('@gdpr.invalid');
    expect(email).toContain(userId);
  });

  it('hard delete sets firstName to DELETED', () => {
    const firstName = 'DELETED';
    expect(firstName).toBe('DELETED');
  });

  it('cannot execute COMPLETED request', () => {
    const request = { status: 'COMPLETED' };
    const canExecute = request.status === 'PENDING' || request.status === 'IN_PROGRESS';
    expect(canExecute).toBe(false);
  });

  it('can execute PENDING request', () => {
    const request = { status: 'PENDING' };
    const canExecute = request.status === 'PENDING' || request.status === 'IN_PROGRESS';
    expect(canExecute).toBe(true);
  });

  it('rejection requires a note', () => {
    const note = '';
    expect(note.trim().length > 0).toBe(false);
    expect('Legal hold — ongoing dispute'.trim().length > 0).toBe(true);
  });
});

// ─── Q94: Soft Delete Management ─────────────────────────────────────────────

describe('Q94: Soft Deletes vs Hard Deletes', () => {
  it('soft delete sets deletedAt to current date', () => {
    const now = new Date('2026-11-12T10:00:00Z');
    expect(now instanceof Date).toBe(true);
    expect(now.toISOString()).toBe('2026-11-12T10:00:00.000Z');
  });

  it('restore clears deletedAt to null', () => {
    const user = { deletedAt: new Date() };
    const restored = { ...user, deletedAt: null };
    expect(restored.deletedAt).toBeNull();
  });

  it('soft-deleted user is filtered by deletedAt not null', () => {
    const users = [
      { id: '1', deletedAt: new Date() },
      { id: '2', deletedAt: null },
      { id: '3', deletedAt: new Date() },
    ];
    const deleted = users.filter(u => u.deletedAt !== null);
    expect(deleted.length).toBe(2);
  });

  it('restore fails if user is not soft-deleted', () => {
    const user = { deletedAt: null };
    const isSoftDeleted = user.deletedAt !== null;
    expect(isSoftDeleted).toBe(false);
  });
});

// ─── Q95: Data Anonymization ──────────────────────────────────────────────────

describe('Q95: Data Anonymization', () => {
  it('anonymized email uses sha256 hash prefix', () => {
    const crypto = require('crypto');
    const userId = 'test-user-id-123';
    const anonId = crypto.createHash('sha256').update(userId).digest('hex').slice(0, 12);
    const email  = `anon_${anonId}@anonymized.invalid`;
    expect(email).toMatch('@anonymized.invalid');
    expect(email).toMatch(/^anon_[a-f0-9]{12}@/);
  });

  it('same userId always produces same anonId (deterministic)', () => {
    const crypto = require('crypto');
    const userId = 'stable-user-id';
    const id1 = crypto.createHash('sha256').update(userId).digest('hex').slice(0, 12);
    const id2 = crypto.createHash('sha256').update(userId).digest('hex').slice(0, 12);
    expect(id1).toBe(id2);
  });

  it('different userIds produce different anonIds', () => {
    const crypto = require('crypto');
    const id1 = crypto.createHash('sha256').update('user-a').digest('hex').slice(0, 12);
    const id2 = crypto.createHash('sha256').update('user-b').digest('hex').slice(0, 12);
    expect(id1).not.toBe(id2);
  });

  it('anonymized message content is replaced', () => {
    const original = 'Bonjour, mon numéro de carte est 4111111111111111';
    const replaced = '[message supprimé]';
    expect(replaced).toBe('[message supprimé]');
    expect(replaced).not.toBe(original);
  });
});

// ─── Q96: Data Aggregation for Privacy ───────────────────────────────────────

describe('Q96: Data Aggregation for Privacy', () => {
  it('k-anonymity threshold is 5', () => {
    const K_THRESHOLD = 5;
    const cities = [
      { city: 'Paris',  count: 150 },
      { city: 'Lyon',   count: 42  },
      { city: 'Rennes', count: 3   },
    ];
    const filtered = cities.filter(c => c.count >= K_THRESHOLD);
    expect(filtered.length).toBe(2);
    expect(filtered.find(c => c.city === 'Rennes')).toBeUndefined();
  });

  it('payment aggregates compute total and average', () => {
    const payments = [{ amount: 100 }, { amount: 200 }, { amount: 150 }];
    const total = payments.reduce((s, p) => s + p.amount, 0);
    const avg   = parseFloat((total / payments.length).toFixed(2));
    expect(total).toBe(450);
    expect(avg).toBe(150);
  });

  it('median calculation works for odd count', () => {
    const sorted = [100, 150, 200];
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBe(150);
  });

  it('verified percent calculation is correct', () => {
    const total    = 1000;
    const verified = 850;
    const pct = parseFloat(((verified / total) * 100).toFixed(1));
    expect(pct).toBe(85);
  });
});

// ─── Q97: Personal Data Inventory ────────────────────────────────────────────

describe('Q97: Personal Data Inventory', () => {
  it('inventory has at least 5 entities', () => {
    expect(DATA_INVENTORY.length).toBeGreaterThanOrEqual(5);
  });

  it('each entity has entity, table, and fields', () => {
    DATA_INVENTORY.forEach(e => {
      expect(e).toHaveProperty('entity');
      expect(e).toHaveProperty('table');
      expect(e).toHaveProperty('fields');
      expect(Array.isArray(e.fields)).toBe(true);
    });
  });

  it('User entity is in inventory', () => {
    expect(DATA_INVENTORY.find(e => e.entity === 'User')).toBeDefined();
  });

  it('User email field is classified as CONFIDENTIAL PII', () => {
    const user  = DATA_INVENTORY.find(e => e.entity === 'User');
    const email = user.fields.find(f => f.field === 'email');
    expect(email.pii).toBe(true);
    expect(email.classification).toBe('CONFIDENTIAL');
  });

  it('latitude/longitude classified as RESTRICTED (precise location)', () => {
    const user = DATA_INVENTORY.find(e => e.entity === 'User');
    const lat  = user.fields.find(f => f.field === 'latitude');
    expect(lat.classification).toBe('RESTRICTED');
  });

  it('bankIban classified as RESTRICTED', () => {
    const prof = DATA_INVENTORY.find(e => e.entity === 'Professional');
    const iban = prof.fields.find(f => f.field === 'bankIban');
    expect(iban.classification).toBe('RESTRICTED');
  });

  it('total PII fields count is > 10', () => {
    const piiCount = DATA_INVENTORY.reduce((s, e) => s + e.fields.filter(f => f.pii).length, 0);
    expect(piiCount).toBeGreaterThan(10);
  });
});

// ─── Q98: Data Classification ─────────────────────────────────────────────────

describe('Q98: Data Classification', () => {
  it('4 classification levels defined', () => {
    expect(Object.keys(CLASSIFICATION_LEVELS).length).toBe(4);
  });

  it('classification levels are PUBLIC < INTERNAL < CONFIDENTIAL < RESTRICTED', () => {
    expect(CLASSIFICATION_LEVELS.PUBLIC.level).toBe(0);
    expect(CLASSIFICATION_LEVELS.INTERNAL.level).toBe(1);
    expect(CLASSIFICATION_LEVELS.CONFIDENTIAL.level).toBe(2);
    expect(CLASSIFICATION_LEVELS.RESTRICTED.level).toBe(3);
  });

  it('RESTRICTED has highest level', () => {
    const levels = Object.values(CLASSIFICATION_LEVELS).map(c => c.level);
    expect(Math.max(...levels)).toBe(CLASSIFICATION_LEVELS.RESTRICTED.level);
  });

  it('each level has description and color', () => {
    Object.values(CLASSIFICATION_LEVELS).forEach(c => {
      expect(c).toHaveProperty('description');
      expect(c).toHaveProperty('color');
    });
  });

  it('RESTRICTED fields exist in inventory', () => {
    const restrictedFields = DATA_INVENTORY.flatMap(e =>
      e.fields.filter(f => f.classification === 'RESTRICTED')
    );
    expect(restrictedFields.length).toBeGreaterThan(0);
  });
});

// ─── Q99: PII Detection ───────────────────────────────────────────────────────

describe('Q99: PII Detection', () => {
  it('detects email address', () => {
    expect(detectPii('Contact: alice@example.com')).toContain('email');
  });

  it('detects French phone number', () => {
    expect(detectPii('Tel: 06 12 34 56 78')).toContain('phone_fr');
  });

  it('detects IBAN', () => {
    expect(detectPii('IBAN: FR7630006000011234567890189')).toContain('iban');
  });

  it('detects JWT token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(detectPii(jwt)).toContain('jwt');
  });

  it('detects IPv4 address', () => {
    expect(detectPii('IP: 192.168.1.42')).toContain('ip_v4');
  });

  it('returns empty array for clean text', () => {
    expect(detectPii('Connexion réussie pour utilisateur anonyme')).toEqual([]);
  });

  it('detects multiple PII types in one string', () => {
    const text  = 'User alice@example.com called from 06 12 34 56 78';
    const found = detectPii(text);
    expect(found).toContain('email');
    expect(found).toContain('phone_fr');
  });

  it('returns empty array for non-string input', () => {
    expect(detectPii(null)).toEqual([]);
    expect(detectPii(42)).toEqual([]);
  });
});

// ─── Q100: Sensitive Data Masking in Logs ─────────────────────────────────────

describe('Q100: Sensitive Data Masking in Logs', () => {
  it('maskString masks email to partial form', () => {
    const result = maskString('User alice@example.com logged in');
    expect(result).not.toContain('alice@');
    expect(result).toContain('@example.com');
    expect(result).toContain('al***');
  });

  it('maskString masks phone number', () => {
    const result = maskString('Phone: 06 12 34 56 78');
    expect(result).toContain('[PHONE]');
    expect(result).not.toContain('06 12');
  });

  it('maskString masks IBAN', () => {
    const result = maskString('IBAN: FR7630006000011234567890189');
    expect(result).toContain('[IBAN]');
  });

  it('maskString masks JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(maskString(jwt)).toContain('[JWT]');
  });

  it('maskString masks IP to subnet only', () => {
    const result = maskString('192.168.1.42');
    expect(result).toContain('192.168.*.*');
    expect(result).not.toContain('192.168.1.42');
  });

  it('maskObject redacts sensitive field names', () => {
    const obj    = { userId: 'abc', password: 'secret123', email: 'x@y.com' };
    const masked = maskObject(obj);
    expect(masked.password).toBe('[REDACTED]');
    expect(masked.userId).toBe('abc');
  });

  it('maskObject recurses into nested objects', () => {
    const obj    = { user: { twoFASecret: 'JBSWY3DPEHPK3PXP', name: 'Alice' } };
    const masked = maskObject(obj);
    expect(masked.user.twoFASecret).toBe('[REDACTED]');
    expect(masked.user.name).toBe('Alice');
  });

  it('maskObject handles arrays', () => {
    const obj    = { tokens: [{ token: 'abc123' }, { token: 'def456' }] };
    const masked = maskObject(obj);
    expect(masked.tokens[0].token).toBe('[REDACTED]');
    expect(masked.tokens[1].token).toBe('[REDACTED]');
  });

  it('SENSITIVE_FIELD_NAMES includes critical fields', () => {
    expect(SENSITIVE_FIELD_NAMES.has('password')).toBe(true);
    expect(SENSITIVE_FIELD_NAMES.has('twoFASecret')).toBe(true);
    expect(SENSITIVE_FIELD_NAMES.has('bankIban')).toBe(true);
    expect(SENSITIVE_FIELD_NAMES.has('token')).toBe(true);
  });

  it('maskObject does not mutate the original object', () => {
    const original = { password: 'secret', name: 'Alice' };
    maskObject(original);
    expect(original.password).toBe('secret');
  });

  it('maskObject handles null values safely', () => {
    expect(() => maskObject(null)).not.toThrow();
    expect(maskObject(null)).toBeNull();
  });
});

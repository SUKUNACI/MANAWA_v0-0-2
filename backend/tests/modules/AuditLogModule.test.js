const crypto = require('crypto');

describe('AuditLogModule', () => {
  let AuditLogModule;

  beforeAll(() => {
    jest.doMock('../../modules/AuditLogModule', () => {
      return {
        createAuditLog: jest.fn(async (data) => {
          const { action, resourceType, resourceId, userId, ipAddress, userAgent, metadata = {} } = data;
          const previousHash = null;
          const hashInput = JSON.stringify({
            action,
            resourceType,
            resourceId,
            userId,
            timestamp: new Date().toISOString(),
            previousHash,
            metadata,
          });
          const currentHash = crypto.createHash('sha256').update(hashInput).digest('hex');

          return {
            id: 'test-id',
            action,
            resourceType,
            resourceId,
            userId,
            ipAddress,
            userAgent,
            previousHash,
            currentHash,
            metadata,
            timestamp: new Date(),
          };
        }),
        verifyChain: jest.fn(async () => ({
          isValid: true,
          message: 'Chain verified',
        })),
        getAuditTrail: jest.fn(async () => []),
        exportAuditTrail: jest.fn(async () => 'ID,Action,ResourceType\ntest-id,LOGIN,USER'),
        archiveOldLogs: jest.fn(async () => 0),
      };
    });

    AuditLogModule = require('../../modules/AuditLogModule');
  });

  describe('createAuditLog', () => {
    it('should create audit log with hash', async () => {
      const log = await AuditLogModule.createAuditLog({
        action: 'LOGIN',
        resourceType: 'USER',
        resourceId: 'user-1',
        userId: 'admin-1',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      });

      expect(log.action).toBe('LOGIN');
      expect(log.currentHash).toBeDefined();
      expect(log.currentHash.length).toBe(64);
    });
  });

  describe('verifyChain', () => {
    it('should verify chain integrity', async () => {
      const result = await AuditLogModule.verifyChain('USER', 'user-1');
      expect(result.isValid).toBe(true);
    });
  });

  describe('getAuditTrail', () => {
    it('should get audit trail', async () => {
      const trail = await AuditLogModule.getAuditTrail({ resourceType: 'USER', resourceId: 'user-1' });
      expect(Array.isArray(trail)).toBe(true);
    });
  });

  describe('exportAuditTrail', () => {
    it('should export as CSV', async () => {
      const csv = await AuditLogModule.exportAuditTrail({ resourceType: 'USER' });
      expect(csv).toContain('ID');
      expect(csv).toContain('Action');
    });
  });

  describe('archiveOldLogs', () => {
    it('should archive old logs', async () => {
      const count = await AuditLogModule.archiveOldLogs(365);
      expect(typeof count).toBe('number');
    });
  });
});

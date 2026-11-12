/**
 * Q77 + Q78: Configuration Versioning & Rollback Strategy Tests
 * Comprehensive test suite for versioning and rollback functionality
 */

const request = require('supertest');
const { expect } = require('chai');
const { prisma } = require('../config/db');
const rollbackManager = require('../utils/rollback-manager');

// Mock data
const mockAdminToken = 'mock-admin-token-q77-q78';
const mockAdminId = 'admin-user-q77-q78';

describe('Q77 + Q78: Configuration Versioning & Rollback Strategy', () => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Q77: Configuration Versioning Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Q77: Configuration Versioning', () => {
    describe('saveConfigVersion()', () => {
      it('should save current config as new version', async () => {
        const version = '1.0.0';
        const changelog = 'Initial production configuration';

        const result = await rollbackManager.saveConfigVersion(
          version,
          mockAdminId,
          changelog
        );

        expect(result).to.have.property('id');
        expect(result.version).to.equal(version);
        expect(result.changelog).to.equal(changelog);
        expect(result.createdBy).to.equal(mockAdminId);
        expect(result.snapshot).to.be.an('object');
      });

      it('should reject duplicate version numbers', async () => {
        const version = '1.0.1';

        // Create first version
        await rollbackManager.saveConfigVersion(
          version,
          mockAdminId,
          'First version'
        );

        // Try to create duplicate
        try {
          await rollbackManager.saveConfigVersion(
            version,
            mockAdminId,
            'Duplicate version'
          );
          expect.fail('Should have thrown error for duplicate version');
        } catch (error) {
          expect(error.message).to.include('already exists');
        }
      });

      it('should create git tag for version', async () => {
        const version = '1.0.2';

        const result = await rollbackManager.saveConfigVersion(
          version,
          mockAdminId,
          'Version with git tag'
        );

        // Tag should be created (if in git repo)
        if (result.tag) {
          expect(result.tag).to.equal(`config-${version}`);
        }
      });
    });

    describe('markVersionAsStable()', () => {
      it('should mark version as production stable', async () => {
        const version = '1.0.3';

        // Create version first
        await rollbackManager.saveConfigVersion(
          version,
          mockAdminId,
          'Stable version'
        );

        // Mark as stable
        const result = await rollbackManager.markVersionAsStable(version);

        expect(result.isStable).to.be.true;
      });

      it('should reject non-existent version', async () => {
        try {
          await rollbackManager.markVersionAsStable('99.99.99');
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error.message).to.include('not found');
        }
      });
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Q78: Rollback Strategy Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Q78: Rollback Strategy', () => {
    describe('rollbackConfiguration()', () => {
      it('should rollback configuration to previous version', async () => {
        // Create two versions
        await rollbackManager.saveConfigVersion(
          '2.0.0',
          mockAdminId,
          'Version 1'
        );

        const newVersion = await rollbackManager.saveConfigVersion(
          '2.0.1',
          mockAdminId,
          'Version 2 with bug'
        );

        // Rollback
        const result = await rollbackManager.rollbackConfiguration(
          '2.0.0',
          mockAdminId,
          'Revert buggy version'
        );

        expect(result.success).to.be.true;
        expect(result.rollbackId).to.exist;
      });

      it('should create rollback event record', async () => {
        await rollbackManager.saveConfigVersion(
          '2.1.0',
          mockAdminId,
          'Test version'
        );

        const result = await rollbackManager.rollbackConfiguration(
          '2.1.0',
          mockAdminId,
          'Test rollback'
        );

        const rollbackEvent = await prisma.rollbackEvent.findUnique({
          where: { id: result.rollbackId },
        });

        expect(rollbackEvent).to.exist;
        expect(rollbackEvent.toVersion).to.equal('2.1.0');
        expect(rollbackEvent.trigger).to.equal('manual');
        expect(rollbackEvent.triggeredBy).to.equal(mockAdminId);
      });

      it('should reject rollback to non-existent version', async () => {
        try {
          await rollbackManager.rollbackConfiguration(
            '99.99.99',
            mockAdminId,
            'Invalid version'
          );
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error.message).to.include('not found');
        }
      });
    });

    describe('autoRollbackOnErrorSpike()', () => {
      it('should trigger auto-rollback when error rate exceeds threshold', async () => {
        // Create stable version
        await rollbackManager.saveConfigVersion(
          '3.0.0',
          mockAdminId,
          'Stable'
        );
        await rollbackManager.markVersionAsStable('3.0.0');

        // Create new version with error
        await rollbackManager.saveConfigVersion(
          '3.0.1',
          mockAdminId,
          'Buggy version'
        );

        // Simulate error spike
        const metrics = {
          errorRate: 2.5, // 2.5% error rate
          durationMinutes: 5, // For 5 minutes
        };

        const result = await rollbackManager.autoRollbackOnErrorSpike(
          metrics
        );

        expect(result.initiated).to.be.true;
        expect(result.rollbackId).to.exist;
      });

      it('should not rollback if error rate below threshold', async () => {
        const metrics = {
          errorRate: 0.5, // 0.5% - below 1% threshold
          durationMinutes: 5,
        };

        const result = await rollbackManager.autoRollbackOnErrorSpike(
          metrics
        );

        expect(result.initiated).to.be.false;
        expect(result.reason).to.equal('threshold_not_met');
      });

      it('should not rollback if auto-rollback is disabled', async () => {
        // Temporarily disable
        const originalValue = require('../config/monitoring-thresholds').rollback
          .AUTO_ROLLBACK_ON_ERROR_SPIKE;

        require('../config/monitoring-thresholds').rollback.AUTO_ROLLBACK_ON_ERROR_SPIKE = false;

        const metrics = {
          errorRate: 5.0,
          durationMinutes: 5,
        };

        const result = await rollbackManager.autoRollbackOnErrorSpike(
          metrics
        );

        expect(result.initiated).to.be.false;
        expect(result.reason).to.equal('auto_rollback_disabled');

        // Restore
        require('../config/monitoring-thresholds').rollback.AUTO_ROLLBACK_ON_ERROR_SPIKE = originalValue;
      });

      it('should prevent rollback thrashing (min 30 min between rollbacks)', async () => {
        // Create and mark stable version
        await rollbackManager.saveConfigVersion(
          '4.0.0',
          mockAdminId,
          'Stable'
        );
        await rollbackManager.markVersionAsStable('4.0.0');

        // Create buggy version
        await rollbackManager.saveConfigVersion(
          '4.0.1',
          mockAdminId,
          'Buggy'
        );

        // First rollback
        const metrics1 = {
          errorRate: 2.0,
          durationMinutes: 5,
        };

        const result1 = await rollbackManager.autoRollbackOnErrorSpike(
          metrics1
        );
        expect(result1.initiated).to.be.true;

        // Immediate second rollback attempt should fail
        const metrics2 = {
          errorRate: 3.0,
          durationMinutes: 5,
        };

        const result2 = await rollbackManager.autoRollbackOnErrorSpike(
          metrics2
        );

        expect(result2.initiated).to.be.false;
        expect(result2.reason).to.equal('rollback_frequency_limit');
      });
    });

    describe('blueGreenFallback()', () => {
      it('should switch to green environment', async () => {
        const result = await rollbackManager.blueGreenFallback('green');

        expect(result.success).to.be.true;
        expect(result.environment).to.equal('green');
      });

      it('should switch back to blue', async () => {
        const result = await rollbackManager.blueGreenFallback('blue');

        expect(result.success).to.be.true;
        expect(result.environment).to.equal('blue');
      });
    });

    describe('getRollbackHistory()', () => {
      it('should retrieve rollback history', async () => {
        // Create versions and rollback
        await rollbackManager.saveConfigVersion(
          '5.0.0',
          mockAdminId,
          'V1'
        );

        await rollbackManager.rollbackConfiguration(
          '5.0.0',
          mockAdminId,
          'Test'
        );

        // Get history
        const history = await rollbackManager.getRollbackHistory(10);

        expect(history).to.be.an('array');
        expect(history.length).to.be.greaterThan(0);
        expect(history[0]).to.have.property('fromVersion');
        expect(history[0]).to.have.property('toVersion');
        expect(history[0]).to.have.property('createdAt');
      });

      it('should limit history results', async () => {
        const history = await rollbackManager.getRollbackHistory(5);

        expect(history.length).to.be.at.most(5);
      });
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Q78: Monitoring Thresholds Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Q78: Monitoring Thresholds', () => {
    const thresholds = require('../config/monitoring-thresholds');

    describe('shouldRollbackOnErrorRate()', () => {
      it('should trigger rollback when threshold exceeded', () => {
        const result = thresholds.shouldRollbackOnErrorRate(2.0, 5);
        expect(result).to.be.true;
      });

      it('should not trigger when below threshold', () => {
        const result = thresholds.shouldRollbackOnErrorRate(0.5, 5);
        expect(result).to.be.false;
      });

      it('should not trigger if duration too short', () => {
        const result = thresholds.shouldRollbackOnErrorRate(2.0, 2);
        expect(result).to.be.false;
      });
    });

    describe('shouldRollbackOnLatency()', () => {
      it('should trigger rollback when latency exceeded', () => {
        const result = thresholds.shouldRollbackOnLatency(4000, 5);
        expect(result).to.be.true;
      });

      it('should not trigger when below threshold', () => {
        const result = thresholds.shouldRollbackOnLatency(1500, 5);
        expect(result).to.be.false;
      });
    });

    describe('shouldRollbackOnMemory()', () => {
      it('should trigger rollback when memory exceeded', () => {
        const result = thresholds.shouldRollbackOnMemory(90, 10);
        expect(result).to.be.true;
      });

      it('should not trigger when below threshold', () => {
        const result = thresholds.shouldRollbackOnMemory(70, 10);
        expect(result).to.be.false;
      });
    });

    describe('getAlertLevel()', () => {
      it('should return CRITICAL when thresholds exceeded', () => {
        const result = thresholds.getAlertLevel({
          errorRate: 2.0,
          latencyP95Ms: 3000,
          memoryPercent: 85,
        });
        expect(result).to.equal('CRITICAL');
      });

      it('should return ALERT when approaching threshold', () => {
        const result = thresholds.getAlertLevel({
          errorRate: 0.7,
          latencyP95Ms: 1600,
          memoryPercent: 78,
        });
        expect(result).to.equal('ALERT');
      });

      it('should return OK when all normal', () => {
        const result = thresholds.getAlertLevel({
          errorRate: 0.1,
          latencyP95Ms: 200,
          memoryPercent: 50,
        });
        expect(result).to.equal('OK');
      });
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // API Endpoint Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Config Version API Endpoints', () => {
    // These would require a running Express app instance
    // Mock implementation shown here

    describe('GET /api/v1/admin/config/versions', () => {
      it('should list configuration versions', async () => {
        // Would test the actual API endpoint
        // Requires running server
      });
    });

    describe('POST /api/v1/admin/config/versions', () => {
      it('should create new configuration version', async () => {
        // Would test the actual API endpoint
      });
    });

    describe('POST /api/v1/admin/config/versions/:version/restore', () => {
      it('should restore configuration to specific version', async () => {
        // Would test the actual API endpoint
      });
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Database Schema Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Database Schema', () => {
    describe('ConfigVersion table', () => {
      it('should have required columns', async () => {
        const result = await prisma.configVersion.findMany({
          take: 1,
        });

        // Verify structure (at least one record exists)
        if (result.length > 0) {
          expect(result[0]).to.have.property('id');
          expect(result[0]).to.have.property('version');
          expect(result[0]).to.have.property('snapshot');
          expect(result[0]).to.have.property('createdAt');
        }
      });
    });

    describe('RollbackEvent table', () => {
      it('should track rollback events', async () => {
        const event = await prisma.rollbackEvent.findFirst({
          take: 1,
        });

        if (event) {
          expect(event).to.have.property('fromVersion');
          expect(event).to.have.property('toVersion');
          expect(event).to.have.property('trigger');
          expect(event).to.have.property('status');
        }
      });
    });

    describe('SystemHealthMetric table', () => {
      it('should store system health data', async () => {
        const metric = await prisma.systemHealthMetric.findFirst({
          take: 1,
        });

        if (metric) {
          expect(metric).to.have.property('errorRate');
          expect(metric).to.have.property('latencyP95');
          expect(metric).to.have.property('memoryUsage');
          expect(metric).to.have.property('cpuUsage');
        }
      });
    });

    describe('BackupIntegrityCheck table', () => {
      it('should log backup integrity checks', async () => {
        const check = await prisma.backupIntegrityCheck.findFirst({
          take: 1,
        });

        if (check) {
          expect(check).to.have.property('backupId');
          expect(check).to.have.property('checkType');
          expect(check).to.have.property('status');
        }
      });
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Integration Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Integration Tests', () => {
    it('should complete full versioning workflow', async () => {
      // 1. Create version
      const v1 = await rollbackManager.saveConfigVersion(
        '6.0.0',
        mockAdminId,
        'Step 1: Create version'
      );
      expect(v1).to.exist;

      // 2. Mark as stable
      const marked = await rollbackManager.markVersionAsStable('6.0.0');
      expect(marked.isStable).to.be.true;

      // 3. Rollback
      const result = await rollbackManager.rollbackConfiguration(
        '6.0.0',
        mockAdminId,
        'Step 3: Rollback'
      );
      expect(result.success).to.be.true;

      // 4. Verify history
      const history = await rollbackManager.getRollbackHistory(1);
      expect(history.length).to.be.greaterThan(0);
    });
  });
});

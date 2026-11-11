const { logPaymentStatus } = require('../../utils/paymentAudit');

// ── Mock Prisma ────────────────────────────────────────────────────────────────
jest.mock('../../config/db', () => ({
  paymentAuditLog: {
    create: jest.fn(),
  },
}));

const prisma = require('../../config/db');

// ══════════════════════════════════════════════════════════════════════════════
// logPaymentStatus - Payment audit logging
// ══════════════════════════════════════════════════════════════════════════════

describe('logPaymentStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.paymentAuditLog.create.mockResolvedValue({
      id: 'log-1',
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
      triggeredBy: 'system',
    });
  });

  test('should create audit log with minimal required fields', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
    };

    await logPaymentStatus(logData);

    expect(prisma.paymentAuditLog.create).toHaveBeenCalledWith({
      data: {
        paymentId: 'pay-1',
        fromStatus: 'PENDING',
        toStatus: 'COMPLETED',
        reason: 'webhook',
        triggeredBy: 'system',
        ipAddress: null,
        metadata: null,
      },
    });
  });

  test('should use "system" as default triggeredBy value', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.triggeredBy).toBe('system');
  });

  test('should override triggeredBy with provided user ID', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'manual',
      triggeredBy: 'admin-user-1',
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.triggeredBy).toBe('admin-user-1');
  });

  test('should include IP address when provided', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
      ipAddress: '192.168.1.1',
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.ipAddress).toBe('192.168.1.1');
  });

  test('should stringify metadata object as JSON', async () => {
    const metadata = {
      geniuspayRef: 'gp-12345',
      amountReceived: 100000,
      originalAmount: 100000,
    };

    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
      metadata,
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.metadata).toBe(JSON.stringify(metadata));
  });

  test('should keep metadata as null if not provided', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.metadata).toBeNull();
  });

  test('should keep metadata as null if explicitly set to null', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
      metadata: null,
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.metadata).toBeNull();
  });

  test('should handle complex metadata with nested objects', async () => {
    const metadata = {
      geniuspay: {
        reference: 'REF-12345',
        status: 'COMPLETED',
        timestamp: '2026-01-01T00:00:00Z',
      },
      reconciliation: {
        bankRef: 'BANK-567',
        verified: true,
      },
    };

    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'reconciliation',
      metadata,
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.metadata).toBe(JSON.stringify(metadata));
  });

  test('should handle metadata with special characters', async () => {
    const metadata = {
      description: 'Remboursement client "ACME Corp"',
      reason: "Client's request - service not satisfactory",
    };

    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'COMPLETED',
      toStatus: 'REFUNDED',
      reason: 'manual_refund',
      metadata,
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    const stringified = callArgs.data.metadata;
    const parsed = JSON.parse(stringified);

    expect(parsed.description).toContain('ACME Corp');
    expect(parsed.reason).toContain("service not satisfactory");
  });

  test('should log all status transition types', async () => {
    const transitions = [
      { fromStatus: 'PENDING', toStatus: 'COMPLETED', reason: 'webhook' },
      { fromStatus: 'COMPLETED', toStatus: 'REFUNDED', reason: 'manual_refund' },
      { fromStatus: 'PENDING', toStatus: 'FAILED', reason: 'payment_declined' },
      { fromStatus: 'FAILED', toStatus: 'PENDING', reason: 'retry' },
    ];

    for (const transition of transitions) {
      await logPaymentStatus({
        paymentId: 'pay-1',
        ...transition,
      });
    }

    expect(prisma.paymentAuditLog.create).toHaveBeenCalledTimes(4);
  });

  test('should handle database errors gracefully without throwing', async () => {
    const dbError = new Error('Database connection failed');
    prisma.paymentAuditLog.create.mockRejectedValue(dbError);

    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
    };

    // Should not throw
    await expect(logPaymentStatus(logData)).resolves.toBeUndefined();
  });

  test('should catch and log errors without rethrowing', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const dbError = new Error('Database error');
    prisma.paymentAuditLog.create.mockRejectedValue(dbError);

    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
    };

    await logPaymentStatus(logData);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[AuditLog] Erreur écriture log paiement:',
      expect.stringContaining('Database error')
    );

    consoleErrorSpy.mockRestore();
  });

  test('should log payment status changes triggered by webhooks', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
      metadata: {
        webhookEvent: 'payment.completed',
        geniuspayRef: 'gp-12345',
      },
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.reason).toBe('webhook');
    expect(callArgs.data.triggeredBy).toBe('system');
  });

  test('should log payment reconciliation checks', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'COMPLETED',
      toStatus: 'COMPLETED', // Status unchanged, but reconciliation happened
      reason: 'recheck',
      triggeredBy: 'cron-job',
      metadata: {
        reconciliationStatus: 'verified',
        bankRef: 'BANK-567',
      },
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.reason).toBe('recheck');
    expect(callArgs.data.fromStatus).toBe('COMPLETED');
  });

  test('should log manual payment adjustments', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'FAILED',
      toStatus: 'COMPLETED',
      reason: 'manual_override',
      triggeredBy: 'admin-user-1',
      ipAddress: '192.168.1.50',
      metadata: {
        adminNotes: 'Payment manually marked as completed after bank confirmation',
      },
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.triggeredBy).toBe('admin-user-1');
    expect(callArgs.data.ipAddress).toBe('192.168.1.50');
  });

  test('should maintain audit trail for full payment lifecycle', async () => {
    const paymentId = 'pay-1';
    const lifecycle = [
      {
        paymentId,
        fromStatus: null,
        toStatus: 'PENDING',
        reason: 'payment_initiated',
        triggeredBy: 'system',
      },
      {
        paymentId,
        fromStatus: 'PENDING',
        toStatus: 'PROCESSING',
        reason: 'webhook',
        triggeredBy: 'system',
      },
      {
        paymentId,
        fromStatus: 'PROCESSING',
        toStatus: 'COMPLETED',
        reason: 'webhook',
        triggeredBy: 'system',
      },
    ];

    for (const entry of lifecycle) {
      await logPaymentStatus(entry);
    }

    expect(prisma.paymentAuditLog.create).toHaveBeenCalledTimes(3);
  });

  test('should handle concurrent audit log calls without conflicts', async () => {
    const promises = [
      logPaymentStatus({
        paymentId: 'pay-1',
        fromStatus: 'PENDING',
        toStatus: 'COMPLETED',
        reason: 'webhook',
      }),
      logPaymentStatus({
        paymentId: 'pay-2',
        fromStatus: 'PENDING',
        toStatus: 'FAILED',
        reason: 'payment_declined',
      }),
      logPaymentStatus({
        paymentId: 'pay-3',
        fromStatus: 'PENDING',
        toStatus: 'COMPLETED',
        reason: 'webhook',
      }),
    ];

    await Promise.all(promises);

    expect(prisma.paymentAuditLog.create).toHaveBeenCalledTimes(3);
  });

  test('should handle empty string metadata gracefully', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
      metadata: {},
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.metadata).toBe('{}');
  });

  test('should properly encode metadata with unicode characters', async () => {
    const metadata = {
      notes: 'Paiement reçu - Merci beaucoup',
      region: 'Côte d\'Ivoire',
    };

    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
      metadata,
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    const parsed = JSON.parse(callArgs.data.metadata);
    expect(parsed.notes).toBe('Paiement reçu - Merci beaucoup');
    expect(parsed.region).toBe('Côte d\'Ivoire');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Error Handling & Edge Cases
// ══════════════════════════════════════════════════════════════════════════════

describe('paymentAudit - Error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should not throw on constraint violations', async () => {
    const constraintError = new Error('Unique constraint failed');
    constraintError.code = 'P2002';

    prisma.paymentAuditLog.create.mockRejectedValue(constraintError);

    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
    };

    await expect(logPaymentStatus(logData)).resolves.toBeUndefined();
  });

  test('should handle null paymentId', async () => {
    const logData = {
      paymentId: null,
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      reason: 'webhook',
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.paymentId).toBeNull();
  });

  test('should handle missing fields gracefully', async () => {
    const logData = {
      paymentId: 'pay-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
    };

    await logPaymentStatus(logData);

    const callArgs = prisma.paymentAuditLog.create.mock.calls[0][0];
    expect(callArgs.data.reason).toBeUndefined();
  });
});

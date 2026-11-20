'use strict';

/**
 * Tests — subscriptionMailer (Phase 3)
 *
 * Coverage :
 *   - sendSubscriptionActivated : envoi email + reçu PDF via Cloudinary
 *   - sendSubscriptionActivated : résiste à une panne PDFKit (email envoyé quand même)
 *   - sendPaymentFailed, sendPaymentCancelled, sendPaymentExpired
 *   - sendGraceReminder, sendSubscriptionExpired
 *   - Résistance aux pannes Mailjet (never throws)
 */

// ─── Mocks (définis avant tout require du module à tester) ────────────────────

const mockMailerSend    = jest.fn().mockResolvedValue({});
const mockGeneratePdf   = jest.fn().mockResolvedValue(Buffer.from('fake-pdf'));
const mockUploadBuffer  = jest.fn().mockResolvedValue('https://cdn.test/receipt.pdf');

jest.mock('../config/mailer', () => ({ send: mockMailerSend }));
jest.mock('../utils/generateSubscriptionReceipt', () => ({
  generateSubscriptionReceiptBuffer: mockGeneratePdf,
}));
jest.mock('../config/cloudinary', () => ({ uploadBuffer: mockUploadBuffer }));
jest.mock('../utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const subMailer = require('../utils/subscriptionMailer');

// ─── Reset entre tests ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockMailerSend.mockResolvedValue({});
  mockGeneratePdf.mockResolvedValue(Buffer.from('fake-pdf'));
  mockUploadBuffer.mockResolvedValue('https://cdn.test/receipt.pdf');
});

// ═══════════════════════════════════════════════════════════════════════════════
// sendSubscriptionActivated
// ═══════════════════════════════════════════════════════════════════════════════

describe('sendSubscriptionActivated', () => {
  it('sends an email to the professional', async () => {
    await subMailer.sendSubscriptionActivated({
      email: 'pro@test.com',
      firstName: 'Alice',
      tier: 'PRO',
      billingCycle: 'MONTHLY',
      amount: 5000,
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      reference: 'gp-ref-123',
    });
    expect(mockMailerSend).toHaveBeenCalledTimes(1);
    const { to, subject } = mockMailerSend.mock.calls[0][0];
    expect(to).toBe('pro@test.com');
    expect(subject).toContain('activé');
  });

  it('includes receipt URL in the email when PDF generation succeeds', async () => {
    await subMailer.sendSubscriptionActivated({
      email: 'pro@test.com', firstName: 'Alice', tier: 'PRO',
      billingCycle: 'MONTHLY', amount: 5000,
      startedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      reference: 'gp-ref-123',
    });
    const { html } = mockMailerSend.mock.calls[0][0];
    expect(html).toContain('cdn.test/receipt.pdf');
  });

  it('still sends email when PDF generation fails (no receipt link)', async () => {
    mockGeneratePdf.mockRejectedValueOnce(new Error('PDFKit crash'));
    await expect(subMailer.sendSubscriptionActivated({
      email: 'pro@test.com', firstName: 'Alice', tier: 'ELITE',
      billingCycle: 'YEARLY', amount: 100000,
      startedAt: new Date(), expiresAt: new Date(),
    })).resolves.toBeUndefined();
    expect(mockMailerSend).toHaveBeenCalledTimes(1);
  });

  it('still sends email when Cloudinary upload fails (no receipt link)', async () => {
    mockUploadBuffer.mockRejectedValueOnce(new Error('Cloudinary error'));
    await expect(subMailer.sendSubscriptionActivated({
      email: 'pro@test.com', firstName: 'Alice', tier: 'PRO',
      billingCycle: 'MONTHLY', amount: 5000,
      startedAt: new Date(), expiresAt: new Date(),
    })).resolves.toBeUndefined();
    expect(mockMailerSend).toHaveBeenCalledTimes(1);
  });

  it('never throws when mailer.send fails', async () => {
    mockMailerSend.mockRejectedValueOnce(new Error('SMTP error'));
    await expect(subMailer.sendSubscriptionActivated({
      email: 'bad@test.com', firstName: 'X', tier: 'PRO',
      billingCycle: 'MONTHLY', amount: 5000,
      startedAt: new Date(), expiresAt: new Date(),
    })).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sendPaymentFailed
// ═══════════════════════════════════════════════════════════════════════════════

describe('sendPaymentFailed', () => {
  it('sends an email with grace period information', async () => {
    const gracePeriodEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await subMailer.sendPaymentFailed({
      email: 'pro@test.com', firstName: 'Alice', tier: 'ESSENTIEL', gracePeriodEndsAt,
    });
    expect(mockMailerSend).toHaveBeenCalledTimes(1);
    const { subject, html } = mockMailerSend.mock.calls[0][0];
    expect(subject).toContain('Paiement échoué');
    expect(html).toContain('grâce');
  });

  it('never throws when mailer.send fails', async () => {
    mockMailerSend.mockRejectedValueOnce(new Error('SMTP error'));
    await expect(subMailer.sendPaymentFailed({
      email: 'bad@test.com', firstName: 'X', tier: 'PRO', gracePeriodEndsAt: new Date(),
    })).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sendPaymentCancelled
// ═══════════════════════════════════════════════════════════════════════════════

describe('sendPaymentCancelled', () => {
  it('sends an email', async () => {
    await subMailer.sendPaymentCancelled({ email: 'pro@test.com', firstName: 'Alice', tier: 'PRO' });
    expect(mockMailerSend).toHaveBeenCalledTimes(1);
  });

  it('never throws when mailer.send fails', async () => {
    mockMailerSend.mockRejectedValueOnce(new Error('SMTP error'));
    await expect(subMailer.sendPaymentCancelled({
      email: 'bad@test.com', firstName: 'X', tier: 'PRO',
    })).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sendPaymentExpired
// ═══════════════════════════════════════════════════════════════════════════════

describe('sendPaymentExpired', () => {
  it('sends an email', async () => {
    await subMailer.sendPaymentExpired({ email: 'pro@test.com', firstName: 'Alice', tier: 'PRO' });
    expect(mockMailerSend).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sendGraceReminder
// ═══════════════════════════════════════════════════════════════════════════════

describe('sendGraceReminder', () => {
  it('sends an email with the deadline date', async () => {
    const gracePeriodEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await subMailer.sendGraceReminder({
      email: 'pro@test.com', firstName: 'Alice', tier: 'PRO', gracePeriodEndsAt,
    });
    expect(mockMailerSend).toHaveBeenCalledTimes(1);
    const { subject } = mockMailerSend.mock.calls[0][0];
    expect(subject).toContain('Dernière chance');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sendSubscriptionExpired
// ═══════════════════════════════════════════════════════════════════════════════

describe('sendSubscriptionExpired', () => {
  it('sends an email announcing return to Gratuit', async () => {
    await subMailer.sendSubscriptionExpired({ email: 'pro@test.com', firstName: 'Alice', tier: 'PRO' });
    expect(mockMailerSend).toHaveBeenCalledTimes(1);
    const { subject } = mockMailerSend.mock.calls[0][0];
    expect(subject).toContain('résilié');
  });
});

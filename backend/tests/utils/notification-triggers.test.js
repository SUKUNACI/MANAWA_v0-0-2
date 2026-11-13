'use strict';

/**
 * Tests pour utils/notification-triggers.js
 * Envoie une notification typée en persistant via Prisma
 */

// Mock logger avant le require du module
jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

// Mock Prisma via config/db
jest.mock('../../config/db', () => ({
  notification: {
    create: jest.fn(),
  },
}));

const { sendNotification } = require('../../utils/notification-triggers');
const prisma = require('../../config/db');
const logger = require('../../utils/logger');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendNotification', () => {
  describe('cas nominaux', () => {
    it('crée une notification avec les bons champs', async () => {
      prisma.notification.create.mockResolvedValueOnce({ id: 'notif-1' });

      await sendNotification('PAYMENT_RETRY_INITIATED', {
        userId: 'user-123',
        data: { amount: 50000 },
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          type: 'PAYMENT_RETRY_INITIATED',
          title: 'PAYMENT_RETRY_INITIATED',
          data: { amount: 50000 },
          read: false,
        },
      });
    });

    it('crée une notification sans data (data par défaut = {})', async () => {
      prisma.notification.create.mockResolvedValueOnce({ id: 'notif-2' });

      await sendNotification('BOOKING_CONFIRMED', { userId: 'user-456' });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-456',
          type: 'BOOKING_CONFIRMED',
          title: 'BOOKING_CONFIRMED',
          data: {},
          read: false,
        },
      });
    });

    it('marque read à false par défaut', async () => {
      prisma.notification.create.mockResolvedValueOnce({ id: 'notif-3' });

      await sendNotification('TEST_TYPE', { userId: 'user-789' });

      const callArg = prisma.notification.create.mock.calls[0][0];
      expect(callArg.data.read).toBe(false);
    });

    it('utilise le type comme titre de notification', async () => {
      prisma.notification.create.mockResolvedValueOnce({ id: 'notif-4' });

      await sendNotification('QUOTE_RECEIVED', { userId: 'user-001' });

      const callArg = prisma.notification.create.mock.calls[0][0];
      expect(callArg.data.title).toBe('QUOTE_RECEIVED');
    });

    it('résout sans valeur de retour explicite (void)', async () => {
      prisma.notification.create.mockResolvedValueOnce({ id: 'notif-5' });

      const result = await sendNotification('SOME_TYPE', { userId: 'user-002' });

      // La fonction ne retourne rien, donc undefined
      expect(result).toBeUndefined();
    });
  });

  describe('gestion d\'erreurs', () => {
    it('log un warning si Prisma lève une erreur', async () => {
      const dbError = new Error('DB connection failed');
      prisma.notification.create.mockRejectedValueOnce(dbError);

      // Ne doit pas propager l'erreur
      await expect(
        sendNotification('PAYMENT_FAILED', { userId: 'user-999' })
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        '[Notification] Failed to persist notification',
        expect.objectContaining({
          type: 'PAYMENT_FAILED',
          userId: 'user-999',
          error: 'DB connection failed',
        })
      );
    });

    it('ne propage pas l\'erreur DB (resilience silencieuse)', async () => {
      prisma.notification.create.mockRejectedValueOnce(new Error('timeout'));

      await expect(
        sendNotification('ANY_TYPE', { userId: 'any-user' })
      ).resolves.not.toThrow();
    });

    it('inclut le type et l\'userId dans le log de warning', async () => {
      prisma.notification.create.mockRejectedValueOnce(new Error('oops'));

      await sendNotification('BOOKING_CANCELLED', { userId: 'user-cancel' });

      const warnArgs = logger.warn.mock.calls[0];
      expect(warnArgs[1].type).toBe('BOOKING_CANCELLED');
      expect(warnArgs[1].userId).toBe('user-cancel');
    });
  });

  describe('cas limites', () => {
    it('fonctionne avec des données complexes dans data', async () => {
      prisma.notification.create.mockResolvedValueOnce({ id: 'notif-complex' });

      const complexData = {
        bookingId: 'booking-123',
        professionalName: 'Jean Dupont',
        amount: 150000,
        date: '2026-11-15',
        nested: { key: 'value' },
      };

      await sendNotification('BOOKING_UPDATE', { userId: 'user-10', data: complexData });

      const callArg = prisma.notification.create.mock.calls[0][0];
      expect(callArg.data.data).toEqual(complexData);
    });

    it('fonctionne quand opts est omis (destructuring par défaut)', async () => {
      prisma.notification.create.mockResolvedValueOnce({ id: 'notif-default' });

      // sendNotification(type, opts={}) — opts manquant
      await expect(sendNotification('TYPE_ONLY')).resolves.toBeUndefined();
    });
  });
});

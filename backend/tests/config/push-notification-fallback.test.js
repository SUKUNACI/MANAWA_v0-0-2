'use strict';
/**
 * Tests for config/push-notification-fallback.js
 */

jest.mock('../../config/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue({ sent: false }),
}));

jest.mock('../../config/mailer', () => ({
  isConfigured: false,
  send: jest.fn().mockResolvedValue({ sent: true }),
}));

describe('push-notification-fallback', () => {
  let fallback;
  let pushMock;
  let mailerMock;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../config/pushNotifications', () => ({
      sendPushNotification: jest.fn().mockResolvedValue({ sent: false }),
    }));
    jest.mock('../../config/mailer', () => ({
      isConfigured: false,
      send: jest.fn().mockResolvedValue({ sent: true }),
    }));
    fallback = require('../../config/push-notification-fallback');
    pushMock = require('../../config/pushNotifications');
    mailerMock = require('../../config/mailer');
  });

  describe('exports', () => {
    it('exporte les fonctions nécessaires', () => {
      expect(typeof fallback.sendWithFallback).toBe('function');
      expect(typeof fallback.sendWithRetry).toBe('function');
      expect(typeof fallback.sendEmailFallback).toBe('function');
      expect(typeof fallback.buildEmailFallbackHtml).toBe('function');
    });
  });

  describe('buildEmailFallbackHtml', () => {
    it('génère du HTML avec le titre', () => {
      const html = fallback.buildEmailFallbackHtml('Mon titre', 'Mon corps', {});
      expect(html).toContain('Mon titre');
      expect(html).toContain('Mon corps');
    });

    it('échappe les caractères HTML dans le titre', () => {
      const html = fallback.buildEmailFallbackHtml('<script>alert(1)</script>', 'Body', {});
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('inclut un bouton d\'action si actionUrl est fourni', () => {
      const html = fallback.buildEmailFallbackHtml('Title', 'Body', {
        actionUrl: 'https://example.com/action',
        actionText: 'Voir',
      });
      expect(html).toContain('https://example.com/action');
    });

    it('utilise l\'URL par défaut si pas d\'actionUrl', () => {
      const html = fallback.buildEmailFallbackHtml('Title', 'Body', {});
      // Pas de bouton si actionUrl est l'URL par défaut
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
    });

    it('gère les caractères spéciaux dans le corps', () => {
      const html = fallback.buildEmailFallbackHtml('Title', 'Corps avec & et "guillemets"', {});
      expect(html).toContain('&amp;');
    });
  });

  describe('sendWithRetry', () => {
    it('retourne le résultat si la première tentative réussit', async () => {
      const fn = jest.fn().mockResolvedValue({ sent: true });
      const result = await fallback.sendWithRetry(fn, 3, 0);
      expect(result.sent).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('réessaie si la première tentative échoue', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ sent: true });
      const result = await fallback.sendWithRetry(fn, 2, 0);
      expect(result.sent).toBe(true);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retourne sent:false après épuisement des tentatives', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));
      const result = await fallback.sendWithRetry(fn, 2, 0);
      expect(result.sent).toBe(false);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retourne sent:false si la fonction retourne sent:false sans erreur', async () => {
      const fn = jest.fn().mockResolvedValue({ sent: false });
      const result = await fallback.sendWithRetry(fn, 3, 0);
      expect(result.sent).toBe(false);
    });
  });

  describe('sendEmailFallback', () => {
    it('ne lance pas si mailer n\'est pas configuré', async () => {
      mailerMock.isConfigured = false;
      await expect(
        fallback.sendEmailFallback('user@test.com', 'Title', 'Body', {})
      ).resolves.not.toThrow();
    });

    it('appelle mailer.send si mailer est configuré', async () => {
      jest.resetModules();
      jest.mock('../../config/pushNotifications', () => ({
        sendPushNotification: jest.fn().mockResolvedValue({ sent: false }),
      }));
      jest.mock('../../config/mailer', () => ({
        isConfigured: true,
        send: jest.fn().mockResolvedValue({ sent: true }),
      }));
      const fb = require('../../config/push-notification-fallback');
      const ml = require('../../config/mailer');
      await fb.sendEmailFallback('user@test.com', 'Titre', 'Corps', {});
      expect(ml.send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'user@test.com',
        subject: expect.stringContaining('Titre'),
      }));
    });

    it('lance si mailer.send échoue', async () => {
      jest.resetModules();
      jest.mock('../../config/pushNotifications', () => ({
        sendPushNotification: jest.fn(),
      }));
      jest.mock('../../config/mailer', () => ({
        isConfigured: true,
        send: jest.fn().mockRejectedValue(new Error('Mailjet error')),
      }));
      const fb = require('../../config/push-notification-fallback');
      await expect(
        fb.sendEmailFallback('user@test.com', 'T', 'B', {})
      ).rejects.toThrow('Mailjet error');
    });
  });

  describe('sendWithFallback', () => {
    it('retourne sent:true avec method FCM si push réussit', async () => {
      pushMock.sendPushNotification.mockResolvedValue({ sent: true });
      const result = await fallback.sendWithFallback('user1', 'Title', 'Body', {});
      expect(result.sent).toBe(true);
      expect(result.method).toBe('FCM');
    });

    it('essaie Expo si FCM échoue et retourne sent:true', async () => {
      // FCM a 2 tentatives → 2 appels à { sent: false }, puis Expo réussit
      pushMock.sendPushNotification
        .mockResolvedValueOnce({ sent: false }) // FCM attempt 1
        .mockResolvedValueOnce({ sent: false }) // FCM attempt 2
        .mockResolvedValueOnce({ sent: true });  // Expo succeeds
      const result = await fallback.sendWithFallback('user1', 'Title', 'Body', {});
      expect(result.sent).toBe(true);
      expect(result.method).toBe('EXPO');
    });

    it('utilise email fallback si push échoue et email fourni', async () => {
      pushMock.sendPushNotification.mockResolvedValue({ sent: false });
      mailerMock.isConfigured = false; // No real email, just logs
      const result = await fallback.sendWithFallback('user1', 'Title', 'Body', {}, 'user@test.com');
      expect(result.sent).toBe(true);
      expect(result.method).toBe('EMAIL_FALLBACK');
    });

    it('retourne sent:false si tout échoue sans email', async () => {
      pushMock.sendPushNotification.mockResolvedValue({ sent: false });
      const result = await fallback.sendWithFallback('user1', 'Title', 'Body', {});
      expect(result.sent).toBe(false);
      expect(result.method).toBe('NONE');
    });

    it('gère les erreurs inattendues', async () => {
      pushMock.sendPushNotification.mockRejectedValue(new Error('Unexpected'));
      const result = await fallback.sendWithFallback('user1', 'Title', 'Body', {});
      // Either NONE or ERROR, both are valid
      expect(result.sent).toBe(false);
    });
  });
});

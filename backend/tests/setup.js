process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-manawa';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.PORT = '4001';

// Désactiver Sentry en test
process.env.SENTRY_DSN = '';

// Mock Firebase pour éviter l'initialisation réelle
jest.mock('../config/firebase-admin', () => ({
  initializeFirebase: () => null,
  getMessaging: () => null,
  isInitialized: () => false,
}), { virtual: true });

// Mock push notifications
jest.mock('../config/pushNotifications', () => ({
  setMessaging: jest.fn(),
  sendPushNotification: jest.fn().mockResolvedValue({ sent: false }),
  sendPushToMultiple: jest.fn().mockResolvedValue({ sent: 0, total: 0 }),
  sendViaFCM: jest.fn().mockResolvedValue(null),
  sendViaExpo: jest.fn().mockResolvedValue(null),
  detectTokenType: jest.fn().mockReturnValue('EXPO'),
}), { virtual: true });

// Mock mailer
jest.mock('../config/mailer', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue({ sent: false, devCode: '123456' }),
  sendPackageSuspensionEmail: jest.fn().mockResolvedValue({ sent: false }),
  isConfigured: false,
}), { virtual: true });

// Désactiver le rate limiter en test
jest.mock('express-rate-limit', () => () => (req, res, next) => next(), { virtual: true });

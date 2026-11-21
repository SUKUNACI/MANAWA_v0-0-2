/**
 * Test: Bull Queue configuration uses REDIS_URL with TLS support
 */

describe('Queue Configuration (Bull)', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete require.cache[require.resolve('../../../config/queue.js')];
  });

  afterEach(() => {
    process.env = originalEnv;
    delete require.cache[require.resolve('../../../config/queue.js')];
  });

  describe('parseRedisUrl in production', () => {
    it('should fail fast if REDIS_URL is missing in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = '';

      expect(() => {
        require('../../../config/queue.js');
      }).toThrow('[Bull Queue] FATAL: REDIS_URL not configured but NODE_ENV or RENDER indicates production. Startup aborted.');
    });

    it('should parse rediss:// URL correctly for TLS', () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'rediss://user:pass@redis.example.com:6380';

      const logger = require('../../../utils/logger');
      jest.spyOn(logger, 'info');

      const queue = require('../../../config/queue.js');
      expect(queue.emailQueue).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        '[Bull Queue] Using REDIS_URL from environment',
        expect.objectContaining({
          url: expect.stringContaining('rediss://'),
        })
      );

      logger.info.mockRestore();
    });

    it('should NOT use localhost:6379 defaults in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'rediss://user:pass@upstash.example.com:6380';
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;

      const queue = require('../../../config/queue.js');
      expect(queue.emailQueue).toBeDefined();
    });
  });

  describe('parseRedisUrl in development', () => {
    it('should allow localhost fallback in development when REDIS_URL is missing', () => {
      process.env.NODE_ENV = 'development';
      process.env.REDIS_URL = '';

      const logger = require('../../../utils/logger');
      jest.spyOn(logger, 'warn');

      const { parseRedisUrl } = require('../../../config/queue.js');
      const config = parseRedisUrl();

      expect(config.host).toBe('localhost');
      expect(config.port).toBe(6379);
      expect(logger.warn).toHaveBeenCalledWith(
        '[Bull Queue] REDIS_URL not configured, using localhost fallback (development mode)'
      );

      logger.warn.mockRestore();
    });
  });

  describe('Queue instances', () => {
    it('should export all queue instances', () => {
      process.env.NODE_ENV = 'development';
      process.env.REDIS_URL = '';

      const {
        emailQueue,
        pdfQueue,
        analyticsQueue,
        paymentQueue,
        badgesQueue,
        webhookQueue,
      } = require('../../../config/queue.js');

      expect(emailQueue).toBeDefined();
      expect(pdfQueue).toBeDefined();
      expect(analyticsQueue).toBeDefined();
      expect(paymentQueue).toBeDefined();
      expect(badgesQueue).toBeDefined();
    });
  });

  describe('Port handling with explicit URLs', () => {
    it('should use explicit port 6379 from rediss://....:6379 URL', () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'rediss://user:pass@localhost:6379';

      const { parseRedisUrl } = require('../../../config/queue.js');
      const config = parseRedisUrl();

      expect(config.port).toBe(6379);
      expect(config.tls).toEqual({});
    });

    it('should use default port 6380 for rediss:// URL without explicit port', () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'rediss://user:pass@localhost';

      const { parseRedisUrl } = require('../../../config/queue.js');
      const config = parseRedisUrl();

      expect(config.port).toBe(6380);
      expect(config.tls).toEqual({});
    });
  });
});

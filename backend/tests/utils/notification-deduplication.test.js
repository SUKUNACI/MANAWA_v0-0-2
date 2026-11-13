/**
 * Tests for utils/notification-deduplication.js
 * Module: isDuplicate, markSent, checkAndMark, clearUserDedup, validateParams,
 *         dedupMiddleware, generateDedupKey, hashContent
 * No prior tests (0% coverage).
 */

jest.mock('../../config/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  deletePattern: jest.fn(),
}));

const cache = require('../../config/redis');
const {
  isDuplicate,
  markSent,
  checkAndMark,
  clearUserDedup,
  validateParams,
  dedupMiddleware,
  generateDedupKey,
  hashContent,
  DEDUP_WINDOW,
  DEDUP_TTL,
} = require('../../utils/notification-deduplication');

describe('notification-deduplication utils', () => {
  beforeEach(() => {
    cache.get.mockReset();
    cache.set.mockReset();
    cache.deletePattern.mockReset();
  });

  describe('hashContent', () => {
    it('should return 8-char hex hash', () => {
      const hash = hashContent('hello world');
      expect(hash).toHaveLength(8);
      expect(/^[a-f0-9]{8}$/.test(hash)).toBe(true);
    });

    it('should return deterministic hash', () => {
      expect(hashContent('test')).toBe(hashContent('test'));
    });

    it('should handle empty string', () => {
      const hash = hashContent('');
      expect(hash).toHaveLength(8);
    });
  });

  describe('generateDedupKey', () => {
    it('should return dedup:userId:type:hash format', () => {
      const key = generateDedupKey('user-1', 'ORDER_CONFIRMED', 'title||body');
      expect(key).toMatch(/^dedup:user-1:ORDER_CONFIRMED:[a-f0-9]{8}$/);
    });
  });

  describe('isDuplicate', () => {
    it('should return false when cache miss', async () => {
      cache.get.mockResolvedValueOnce(null);
      const result = await isDuplicate('user-1', 'TYPE', 'content');
      expect(result).toBe(false);
    });

    it('should return true when cache hit', async () => {
      cache.get.mockResolvedValueOnce(JSON.stringify({ sent: true }));
      const result = await isDuplicate('user-1', 'TYPE', 'content');
      expect(result).toBe(true);
    });

    it('should return false (fail open) on cache error', async () => {
      cache.get.mockRejectedValueOnce(new Error('Redis down'));
      const result = await isDuplicate('user-1', 'TYPE', 'content');
      expect(result).toBe(false);
    });
  });

  describe('markSent', () => {
    it('should return true on success', async () => {
      cache.set.mockResolvedValueOnce('OK');
      const result = await markSent('user-1', 'TYPE', 'content');
      expect(result).toBe(true);
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringMatching(/^dedup:/),
        expect.any(String),
        DEDUP_TTL
      );
    });

    it('should return false (fail open) on cache error', async () => {
      cache.set.mockRejectedValueOnce(new Error('Redis down'));
      const result = await markSent('user-1', 'TYPE', 'content');
      expect(result).toBe(false);
    });
  });

  describe('checkAndMark', () => {
    it('should return isDuplicate=true when already sent', async () => {
      cache.get.mockResolvedValueOnce(JSON.stringify({ sent: true }));
      const result = await checkAndMark('user-1', 'TYPE', 'content');
      expect(result.isDuplicate).toBe(true);
      expect(result.marked).toBe(false);
    });

    it('should mark as sent when not duplicate', async () => {
      cache.get.mockResolvedValueOnce(null);
      cache.set.mockResolvedValueOnce('OK');
      const result = await checkAndMark('user-1', 'TYPE', 'content');
      expect(result.isDuplicate).toBe(false);
      expect(result.marked).toBe(true);
    });
  });

  describe('clearUserDedup', () => {
    it('should delete pattern for all types', async () => {
      cache.deletePattern.mockResolvedValueOnce(3);
      const count = await clearUserDedup('user-1');
      expect(count).toBe(3);
      expect(cache.deletePattern).toHaveBeenCalledWith('dedup:user-1:*');
    });

    it('should delete pattern for specific type', async () => {
      cache.deletePattern.mockResolvedValueOnce(1);
      const count = await clearUserDedup('user-1', 'ORDER_CONFIRMED');
      expect(count).toBe(1);
      expect(cache.deletePattern).toHaveBeenCalledWith('dedup:user-1:ORDER_CONFIRMED:*');
    });

    it('should return 0 on cache error', async () => {
      cache.deletePattern.mockRejectedValueOnce(new Error('Redis down'));
      const count = await clearUserDedup('user-1');
      expect(count).toBe(0);
    });
  });

  describe('validateParams', () => {
    it('should return valid when all params provided', () => {
      const result = validateParams('user-1', 'TYPE', 'title', 'body');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when userId is missing', () => {
      const result = validateParams(null, 'TYPE', 'title', 'body');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid userId');
    });

    it('should fail when type is missing', () => {
      const result = validateParams('user-1', '', 'title', 'body');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid type');
    });

    it('should fail when both title and body are missing', () => {
      const result = validateParams('user-1', 'TYPE', '', '');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Title or body required');
    });

    it('should pass when only title is provided', () => {
      const result = validateParams('user-1', 'TYPE', 'title', '');
      expect(result.valid).toBe(true);
    });

    it('should pass when only body is provided', () => {
      const result = validateParams('user-1', 'TYPE', '', 'body');
      expect(result.valid).toBe(true);
    });

    it('should fail with multiple errors', () => {
      const result = validateParams(null, null, '', '');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe('dedupMiddleware', () => {
    const makeReqRes = (body) => {
      const req = { body };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();
      return { req, res, next };
    };

    it('should call next with valid, non-duplicate payload', async () => {
      cache.get.mockResolvedValueOnce(null);
      cache.set.mockResolvedValueOnce('OK');
      const { req, res, next } = makeReqRes({
        userId: 'user-1',
        type: 'ORDER_CONFIRMED',
        title: 'Commande confirmée',
        body: 'Votre commande est prête.',
      });
      await dedupMiddleware()(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid params', async () => {
      const { req, res, next } = makeReqRes({ userId: null, type: null, title: '', body: '' });
      await dedupMiddleware()(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 429 for duplicate notification', async () => {
      cache.get.mockResolvedValueOnce(JSON.stringify({ sent: true }));
      const { req, res, next } = makeReqRes({
        userId: 'user-1',
        type: 'ORDER_CONFIRMED',
        title: 'Titre',
        body: 'Corps',
      });
      await dedupMiddleware()(req, res, next);
      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  describe('constants', () => {
    it('should export DEDUP_WINDOW as 5000ms', () => {
      expect(DEDUP_WINDOW).toBe(5000);
    });

    it('should export DEDUP_TTL as 6s', () => {
      expect(DEDUP_TTL).toBe(6);
    });
  });
});

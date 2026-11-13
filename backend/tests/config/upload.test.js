'use strict';
/**
 * Tests for config/upload.js
 */

jest.mock('multer', () => {
  const mockMemoryStorage = jest.fn(() => ({}));
  const mockUpload = jest.fn((opts) => ({ opts }));
  mockUpload.memoryStorage = mockMemoryStorage;
  return mockUpload;
});

describe('upload config', () => {
  let upload;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('multer', () => {
      const mockMemoryStorage = jest.fn(() => ({}));
      const mockUpload = jest.fn((opts) => {
        const instance = { opts, fields: jest.fn(), single: jest.fn(), array: jest.fn() };
        return instance;
      });
      mockUpload.memoryStorage = mockMemoryStorage;
      return mockUpload;
    });
    upload = require('../../config/upload');
  });

  describe('exports', () => {
    it('exporte un objet multer (default export)', () => {
      expect(upload).toBeDefined();
    });

    it('exporte verifyMagicBytes', () => {
      expect(typeof upload.verifyMagicBytes).toBe('function');
    });
  });

  describe('fileFilter (via verifyMagicBytes context)', () => {
    it('la config multer est initialisée avec memoryStorage', () => {
      const multer = require('multer');
      expect(multer.memoryStorage).toHaveBeenCalled();
    });

    it('appelle multer avec les bonnes options', () => {
      const multer = require('multer');
      const callArgs = multer.mock.calls[0][0];
      expect(callArgs).toHaveProperty('storage');
      expect(callArgs).toHaveProperty('fileFilter');
      expect(callArgs).toHaveProperty('limits');
      expect(callArgs.limits.fileSize).toBe(8 * 1024 * 1024);
    });
  });

  describe('fileFilter direct', () => {
    it('accepte un fichier JPEG', () => {
      // On doit extraire fileFilter depuis les args de multer
      jest.resetModules();
      let capturedFilter;
      jest.mock('multer', () => {
        const mockMemoryStorage = jest.fn(() => ({}));
        const fn = jest.fn((opts) => {
          capturedFilter = opts.fileFilter;
          return {};
        });
        fn.memoryStorage = mockMemoryStorage;
        return fn;
      });
      require('../../config/upload');

      const req = {};
      const file = { mimetype: 'image/jpeg' };
      const cb = jest.fn();
      capturedFilter(req, file, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('accepte un fichier PNG', () => {
      jest.resetModules();
      let capturedFilter;
      jest.mock('multer', () => {
        const fn = jest.fn((opts) => { capturedFilter = opts.fileFilter; return {}; });
        fn.memoryStorage = jest.fn(() => ({}));
        return fn;
      });
      require('../../config/upload');
      const cb = jest.fn();
      capturedFilter({}, { mimetype: 'image/png' }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('accepte un fichier WebP', () => {
      jest.resetModules();
      let capturedFilter;
      jest.mock('multer', () => {
        const fn = jest.fn((opts) => { capturedFilter = opts.fileFilter; return {}; });
        fn.memoryStorage = jest.fn(() => ({}));
        return fn;
      });
      require('../../config/upload');
      const cb = jest.fn();
      capturedFilter({}, { mimetype: 'image/webp' }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('accepte un fichier PDF', () => {
      jest.resetModules();
      let capturedFilter;
      jest.mock('multer', () => {
        const fn = jest.fn((opts) => { capturedFilter = opts.fileFilter; return {}; });
        fn.memoryStorage = jest.fn(() => ({}));
        return fn;
      });
      require('../../config/upload');
      const cb = jest.fn();
      capturedFilter({}, { mimetype: 'application/pdf' }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('rejette un type de fichier non autorisé', () => {
      jest.resetModules();
      let capturedFilter;
      jest.mock('multer', () => {
        const fn = jest.fn((opts) => { capturedFilter = opts.fileFilter; return {}; });
        fn.memoryStorage = jest.fn(() => ({}));
        return fn;
      });
      require('../../config/upload');
      const cb = jest.fn();
      capturedFilter({}, { mimetype: 'application/exe' }, cb);
      expect(cb).toHaveBeenCalledWith(expect.any(Error));
      expect(cb.mock.calls[0][0].message).toContain('Type de fichier non autorisé');
    });

    it('rejette video/mp4', () => {
      jest.resetModules();
      let capturedFilter;
      jest.mock('multer', () => {
        const fn = jest.fn((opts) => { capturedFilter = opts.fileFilter; return {}; });
        fn.memoryStorage = jest.fn(() => ({}));
        return fn;
      });
      require('../../config/upload');
      const cb = jest.fn();
      capturedFilter({}, { mimetype: 'video/mp4' }, cb);
      expect(cb).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('verifyMagicBytes', () => {
    it('appelle next() si aucun fichier dans la requête', async () => {
      const req = {};
      const res = {};
      const next = jest.fn();
      await upload.verifyMagicBytes(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('appelle next() si req.files est un tableau vide', async () => {
      const req = { files: [] };
      const res = {};
      const next = jest.fn();
      await upload.verifyMagicBytes(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});

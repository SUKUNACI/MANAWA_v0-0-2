'use strict';
/**
 * Tests for config/cloudinary.js (simple upload config)
 */

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
    },
  },
}));

describe('cloudinary config', () => {
  let cloudinaryConfig;
  let cloudinaryMock;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('cloudinary', () => ({
      v2: {
        config: jest.fn(),
        uploader: {
          upload_stream: jest.fn(),
        },
      },
    }));
    cloudinaryConfig = require('../../config/cloudinary');
    cloudinaryMock = require('cloudinary').v2;
  });

  describe('exports', () => {
    it('exporte cloudinary et uploadBuffer', () => {
      expect(cloudinaryConfig.cloudinary).toBeDefined();
      expect(typeof cloudinaryConfig.uploadBuffer).toBe('function');
    });
  });

  describe('configuration', () => {
    it('appelle cloudinary.config au chargement', () => {
      expect(cloudinaryMock.config).toHaveBeenCalled();
    });
  });

  describe('uploadBuffer', () => {
    it('appelle uploader.upload_stream avec le bon dossier', async () => {
      const mockStream = { end: jest.fn() };
      let capturedCallback;
      cloudinaryMock.uploader.upload_stream.mockImplementation((opts, cb) => {
        capturedCallback = cb;
        return mockStream;
      });

      const buffer = Buffer.from('test-image-data');
      const folder = 'manawa/avatars';
      const promise = cloudinaryConfig.uploadBuffer(buffer, folder);

      // Simuler un succès Cloudinary
      capturedCallback(null, { secure_url: 'https://res.cloudinary.com/test/image.jpg' });

      const result = await promise;
      expect(result).toBe('https://res.cloudinary.com/test/image.jpg');
      expect(cloudinaryMock.uploader.upload_stream).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'manawa/avatars', resource_type: 'auto' }),
        expect.any(Function)
      );
      expect(mockStream.end).toHaveBeenCalledWith(buffer);
    });

    it('rejette si Cloudinary retourne une erreur', async () => {
      const mockStream = { end: jest.fn() };
      let capturedCallback;
      cloudinaryMock.uploader.upload_stream.mockImplementation((opts, cb) => {
        capturedCallback = cb;
        return mockStream;
      });

      const buffer = Buffer.from('bad-data');
      const promise = cloudinaryConfig.uploadBuffer(buffer, 'manawa/test');
      capturedCallback(new Error('Upload failed'), null);

      await expect(promise).rejects.toThrow('Upload failed');
    });

    it('passe les options supplémentaires à upload_stream', async () => {
      const mockStream = { end: jest.fn() };
      let capturedCallback;
      cloudinaryMock.uploader.upload_stream.mockImplementation((opts, cb) => {
        capturedCallback = cb;
        return mockStream;
      });

      const buffer = Buffer.from('data');
      const extraOptions = { tags: ['test'], public_id: 'custom-id' };
      const promise = cloudinaryConfig.uploadBuffer(buffer, 'manawa/portfolios', extraOptions);
      capturedCallback(null, { secure_url: 'https://cdn.example.com/img.jpg' });

      await promise;
      expect(cloudinaryMock.uploader.upload_stream).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['test'], public_id: 'custom-id' }),
        expect.any(Function)
      );
    });

    it('utilise resource_type auto par défaut', async () => {
      const mockStream = { end: jest.fn() };
      let capturedCallback;
      cloudinaryMock.uploader.upload_stream.mockImplementation((opts, cb) => {
        capturedCallback = cb;
        return mockStream;
      });

      const buffer = Buffer.from('data');
      const promise = cloudinaryConfig.uploadBuffer(buffer, 'manawa/test');
      capturedCallback(null, { secure_url: 'https://cdn.example.com/img.jpg' });

      await promise;
      const callArgs = cloudinaryMock.uploader.upload_stream.mock.calls[0][0];
      expect(callArgs.resource_type).toBe('auto');
    });
  });
});

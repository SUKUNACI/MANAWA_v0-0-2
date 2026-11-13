'use strict';
/**
 * Tests for config/cdn.js (cloudinary enhanced config)
 */

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload_stream: jest.fn() },
  },
}));

describe('cdn config (cloudinary enhanced)', () => {
  let cdn;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('cloudinary', () => ({
      v2: {
        config: jest.fn(),
        uploader: { upload_stream: jest.fn() },
      },
    }));
    cdn = require('../../config/cdn');
  });

  describe('exports', () => {
    it('exporte cloudinary, TRANSFORMATIONS, FOLDERS, VIDEO_PROFILES', () => {
      expect(cdn.cloudinary).toBeDefined();
      expect(cdn.TRANSFORMATIONS).toBeDefined();
      expect(cdn.FOLDERS).toBeDefined();
      expect(cdn.VIDEO_PROFILES).toBeDefined();
    });

    it('exporte UPLOAD_OPTIONS, CACHE_HEADERS, SIGNED_URL_CONFIG', () => {
      expect(cdn.UPLOAD_OPTIONS).toBeDefined();
      expect(cdn.CACHE_HEADERS).toBeDefined();
      expect(cdn.SIGNED_URL_CONFIG).toBeDefined();
    });

    it('exporte ACCOUNT_LIMITS et OPTIMIZATION', () => {
      expect(cdn.ACCOUNT_LIMITS).toBeDefined();
      expect(cdn.OPTIMIZATION).toBeDefined();
    });
  });

  describe('TRANSFORMATIONS', () => {
    it('contient les presets d\'images', () => {
      const { TRANSFORMATIONS } = cdn;
      expect(TRANSFORMATIONS).toHaveProperty('avatar');
      expect(TRANSFORMATIONS).toHaveProperty('thumbnail');
      expect(TRANSFORMATIONS).toHaveProperty('gallery');
      expect(TRANSFORMATIONS).toHaveProperty('hero');
      expect(TRANSFORMATIONS).toHaveProperty('mobile');
      expect(TRANSFORMATIONS).toHaveProperty('pdf_preview');
    });

    it('avatar a les bonnes dimensions', () => {
      const { avatar } = cdn.TRANSFORMATIONS;
      expect(avatar.width).toBe(200);
      expect(avatar.height).toBe(200);
      expect(avatar.crop).toBe('fill');
    });

    it('thumbnail est 300x300', () => {
      const { thumbnail } = cdn.TRANSFORMATIONS;
      expect(thumbnail.width).toBe(300);
      expect(thumbnail.height).toBe(300);
    });

    it('avatar_responsive est un tableau de 3 tailles', () => {
      const { avatar_responsive } = cdn.TRANSFORMATIONS;
      expect(Array.isArray(avatar_responsive)).toBe(true);
      expect(avatar_responsive.length).toBe(3);
    });

    it('gallery_responsive est un tableau de 4 tailles', () => {
      const { gallery_responsive } = cdn.TRANSFORMATIONS;
      expect(Array.isArray(gallery_responsive)).toBe(true);
      expect(gallery_responsive.length).toBe(4);
    });
  });

  describe('FOLDERS', () => {
    it('a tous les dossiers requis', () => {
      const { FOLDERS } = cdn;
      expect(FOLDERS.avatars).toContain('manawa/avatars');
      expect(FOLDERS.portfolio).toContain('manawa/portfolio');
      expect(FOLDERS.documents).toContain('manawa/documents');
      expect(FOLDERS.temp).toContain('manawa/temp');
    });
  });

  describe('VIDEO_PROFILES', () => {
    it('a les profils HLS et mobile', () => {
      const { VIDEO_PROFILES } = cdn;
      expect(VIDEO_PROFILES).toHaveProperty('hls_streaming');
      expect(VIDEO_PROFILES).toHaveProperty('mobile_preview');
      expect(VIDEO_PROFILES).toHaveProperty('web_preview');
    });
  });

  describe('UPLOAD_OPTIONS', () => {
    it('a les options pour image, document, video et temporary', () => {
      const { UPLOAD_OPTIONS } = cdn;
      expect(UPLOAD_OPTIONS).toHaveProperty('image');
      expect(UPLOAD_OPTIONS).toHaveProperty('document');
      expect(UPLOAD_OPTIONS).toHaveProperty('video');
      expect(UPLOAD_OPTIONS).toHaveProperty('temporary');
    });

    it('les uploads n\'écrasent pas par défaut', () => {
      expect(cdn.UPLOAD_OPTIONS.image.overwrite).toBe(false);
      expect(cdn.UPLOAD_OPTIONS.document.overwrite).toBe(false);
    });
  });

  describe('CACHE_HEADERS', () => {
    it('a tous les types de cache', () => {
      const { CACHE_HEADERS } = cdn;
      expect(CACHE_HEADERS).toHaveProperty('versioned');
      expect(CACHE_HEADERS).toHaveProperty('content');
      expect(CACHE_HEADERS).toHaveProperty('dynamic');
      expect(CACHE_HEADERS).toHaveProperty('private');
      expect(CACHE_HEADERS).toHaveProperty('stale_while_revalidate');
    });

    it('versioned a un Cache-Control avec immutable', () => {
      expect(cdn.CACHE_HEADERS.versioned['Cache-Control']).toContain('immutable');
    });

    it('private a les headers no-cache', () => {
      expect(cdn.CACHE_HEADERS.private['Cache-Control']).toContain('no-cache');
    });
  });

  describe('SIGNED_URL_CONFIG', () => {
    it('a les configs default, extended et temporary', () => {
      const { SIGNED_URL_CONFIG } = cdn;
      expect(SIGNED_URL_CONFIG).toHaveProperty('default');
      expect(SIGNED_URL_CONFIG).toHaveProperty('extended');
      expect(SIGNED_URL_CONFIG).toHaveProperty('temporary');
    });

    it('temporary a un expire court', () => {
      expect(cdn.SIGNED_URL_CONFIG.temporary.expire).toBe(300);
    });

    it('extended a un expire d\'un jour', () => {
      expect(cdn.SIGNED_URL_CONFIG.extended.expire).toBe(86400);
    });
  });

  describe('ACCOUNT_LIMITS', () => {
    it('a les limites du compte', () => {
      const { ACCOUNT_LIMITS } = cdn;
      expect(typeof ACCOUNT_LIMITS.maxUploadSize).toBe('number');
      expect(typeof ACCOUNT_LIMITS.maxBatchSize).toBe('number');
      expect(ACCOUNT_LIMITS).toHaveProperty('rateLimit');
    });

    it('maxUploadSize est 100MB', () => {
      expect(cdn.ACCOUNT_LIMITS.maxUploadSize).toBe(100 * 1024 * 1024);
    });
  });

  describe('OPTIMIZATION', () => {
    it('a les options d\'optimisation', () => {
      const { OPTIMIZATION } = cdn;
      expect(OPTIMIZATION.autoQuality).toBe(true);
      expect(OPTIMIZATION.autoFormat).toBe(true);
      expect(OPTIMIZATION).toHaveProperty('quality');
    });

    it('la qualité auto est définie', () => {
      expect(cdn.OPTIMIZATION.quality.auto).toBe('auto');
      expect(typeof cdn.OPTIMIZATION.quality.high).toBe('number');
    });
  });
});

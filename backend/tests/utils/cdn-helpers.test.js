'use strict';

/**
 * Tests pour utils/cdn-helpers.js
 * CDNHelper — génération d'URLs, upload optimisé, suppression, stats
 */

// Mock config/cdn
jest.mock('../../config/cdn', () => ({
  cloudinary: {
    url: jest.fn(),
    api: {
      delete_resources: jest.fn(),
      delete_resources_by_tag: jest.fn(),
      usage: jest.fn(),
      resources: jest.fn(),
      resource: jest.fn(),
    },
  },
  TRANSFORMATIONS: {
    thumbnail: { width: 300, height: 300, crop: 'fill', gravity: 'auto' },
    medium:    { width: 600, height: 400, crop: 'fill' },
    gallery:   { width: 800, height: 600, crop: 'fill' },
    avatar_responsive: [
      { width: 100, height: 100, crop: 'fill', gravity: 'face' },
      { width: 200, height: 200, crop: 'fill', gravity: 'face' },
      { width: 300, height: 300, crop: 'fill', gravity: 'face' },
    ],
    gallery_responsive: [
      { width: 300,  height: 225, crop: 'fill', gravity: 'auto' },
      { width: 600,  height: 450, crop: 'fill', gravity: 'auto' },
      { width: 900,  height: 675, crop: 'fill', gravity: 'auto' },
      { width: 1200, height: 900, crop: 'fill', gravity: 'auto' },
    ],
  },
  FOLDERS: {
    avatars: 'manawa/avatars',
    portfolio: 'manawa/portfolio',
  },
  OPTIMIZATION: {
    quality: { auto: 'auto' },
    autoFormat: true,
    stripMetadata: true,
  },
  CACHE_HEADERS: {
    content: { 'Cache-Control': 'public, max-age=2592000' },
  },
  SIGNED_URL_CONFIG: {
    default:   { type: 'authenticated', sign_url: true, expire: 3600 },
    extended:  { type: 'authenticated', sign_url: true, expire: 86400 },
    temporary: { type: 'authenticated', sign_url: true, expire: 300 },
  },
}));

// Mock config/cloudinary (uploadBuffer)
jest.mock('../../config/cloudinary', () => ({
  uploadBuffer: jest.fn(),
}));

const CDNHelper = require('../../utils/cdn-helpers');
const { cloudinary, TRANSFORMATIONS, SIGNED_URL_CONFIG } = require('../../config/cdn');
const { uploadBuffer } = require('../../config/cloudinary');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── generateImageUrl ─────────────────────────────────────────────────────────

describe('CDNHelper.generateImageUrl', () => {
  it('lève une erreur si publicId manquant', () => {
    expect(() => CDNHelper.generateImageUrl(null)).toThrow('Public ID is required');
    expect(() => CDNHelper.generateImageUrl('')).toThrow('Public ID is required');
    expect(() => CDNHelper.generateImageUrl(undefined)).toThrow('Public ID is required');
  });

  it('appelle cloudinary.url avec secure: true', () => {
    cloudinary.url.mockReturnValue('https://res.cloudinary.com/test/medium');

    CDNHelper.generateImageUrl('folder/image-id');

    expect(cloudinary.url).toHaveBeenCalledWith(
      'folder/image-id',
      expect.objectContaining({ secure: true })
    );
  });

  it('utilise le preset "medium" par défaut', () => {
    cloudinary.url.mockReturnValue('https://res.cloudinary.com/medium-url');

    CDNHelper.generateImageUrl('img-123');

    const callArg = cloudinary.url.mock.calls[0][1];
    expect(callArg.width).toBe(600);
  });

  it('utilise le preset spécifié en paramètre', () => {
    cloudinary.url.mockReturnValue('https://res.cloudinary.com/gallery-url');

    CDNHelper.generateImageUrl('img-123', 'gallery');

    const callArg = cloudinary.url.mock.calls[0][1];
    expect(callArg.width).toBe(800);
  });

  it('tombe en fallback sur "medium" si preset inconnu', () => {
    cloudinary.url.mockReturnValue('https://res.cloudinary.com/fallback');

    CDNHelper.generateImageUrl('img-123', 'unknown_preset');

    const callArg = cloudinary.url.mock.calls[0][1];
    expect(callArg.width).toBe(600);
  });

  it('fusionne les options personnalisées', () => {
    cloudinary.url.mockReturnValue('https://res.cloudinary.com/custom');

    CDNHelper.generateImageUrl('img-123', 'medium', { quality: 90 });

    const callArg = cloudinary.url.mock.calls[0][1];
    expect(callArg.quality).toBe(90);
  });

  it('retourne l\'URL générée par cloudinary.url', () => {
    cloudinary.url.mockReturnValue('https://res.cloudinary.com/my-url');

    const url = CDNHelper.generateImageUrl('img-abc');

    expect(url).toBe('https://res.cloudinary.com/my-url');
  });
});

// ─── generateThumbnail ────────────────────────────────────────────────────────

describe('CDNHelper.generateThumbnail', () => {
  it('lève une erreur si publicId manquant', () => {
    expect(() => CDNHelper.generateThumbnail('')).toThrow('Public ID is required');
  });

  it('appelle cloudinary.url avec les options thumbnail', () => {
    cloudinary.url.mockReturnValue('https://res.cloudinary.com/thumb');

    CDNHelper.generateThumbnail('thumb-id');

    expect(cloudinary.url).toHaveBeenCalledWith(
      'thumb-id',
      expect.objectContaining({ secure: true, width: 300, height: 300 })
    );
  });

  it('fusionne les options personnalisées sur thumbnail', () => {
    cloudinary.url.mockReturnValue('https://res.cloudinary.com/custom-thumb');

    CDNHelper.generateThumbnail('t-id', { width: 100 });

    const callArg = cloudinary.url.mock.calls[0][1];
    expect(callArg.width).toBe(100);
  });

  it('retourne l\'URL', () => {
    cloudinary.url.mockReturnValue('https://cdn.test/thumb.jpg');
    expect(CDNHelper.generateThumbnail('x')).toBe('https://cdn.test/thumb.jpg');
  });
});

// ─── generateResponsiveSet ────────────────────────────────────────────────────

describe('CDNHelper.generateResponsiveSet', () => {
  it('lève une erreur si publicId manquant', () => {
    expect(() => CDNHelper.generateResponsiveSet('')).toThrow('Public ID is required');
  });

  it('lève une erreur si preset inconnu', () => {
    expect(() => CDNHelper.generateResponsiveSet('img', 'unknown')).toThrow('Unknown responsive preset: unknown');
  });

  it('retourne srcset, sizes et src pour gallery_responsive', () => {
    cloudinary.url.mockImplementation((id, opts) => `https://cdn/${opts.width}`);

    const result = CDNHelper.generateResponsiveSet('img-id', 'gallery_responsive');

    expect(result).toHaveProperty('srcset');
    expect(result).toHaveProperty('sizes');
    expect(result).toHaveProperty('src');
  });

  it('srcset contient les largeurs des 4 variantes gallery', () => {
    cloudinary.url.mockImplementation((id, opts) => `https://cdn/${opts.width}`);

    const result = CDNHelper.generateResponsiveSet('img-id', 'gallery_responsive');

    expect(result.srcset).toContain('300w');
    expect(result.srcset).toContain('600w');
    expect(result.srcset).toContain('900w');
    expect(result.srcset).toContain('1200w');
  });

  it('sizes correct pour gallery_responsive', () => {
    cloudinary.url.mockReturnValue('https://cdn/url');
    const result = CDNHelper.generateResponsiveSet('img', 'gallery_responsive');
    expect(result.sizes).toContain('300px');
    expect(result.sizes).toContain('600px');
    expect(result.sizes).toContain('900px');
  });

  it('sizes correct pour avatar_responsive', () => {
    cloudinary.url.mockReturnValue('https://cdn/url');
    const result = CDNHelper.generateResponsiveSet('img', 'avatar_responsive');
    expect(result.sizes).toContain('100px');
    expect(result.sizes).toContain('200px');
    expect(result.sizes).toContain('300px');
  });
});

// ─── uploadWithOptimization ───────────────────────────────────────────────────

describe('CDNHelper.uploadWithOptimization', () => {
  it('lève une erreur si buffer manquant', async () => {
    await expect(CDNHelper.uploadWithOptimization(null, 'folder')).rejects.toThrow('Buffer is required');
  });

  it('lève une erreur si folder manquant', async () => {
    await expect(CDNHelper.uploadWithOptimization(Buffer.from('x'), '')).rejects.toThrow('Folder is required');
  });

  it('appelle uploadBuffer avec les bons paramètres', async () => {
    cloudinary.url.mockReturnValue('https://cdn/url');
    uploadBuffer.mockResolvedValue('https://cdn/manawa/avatars/image123.jpg');

    const buf = Buffer.from('fake-image-data');
    await CDNHelper.uploadWithOptimization(buf, 'manawa/avatars');

    expect(uploadBuffer).toHaveBeenCalledWith(
      buf,
      'manawa/avatars',
      expect.objectContaining({
        folder: 'manawa/avatars',
        resource_type: 'auto',
        tags: expect.arrayContaining(['manawa']),
      })
    );
  });

  it('retourne un objet avec url, publicId, optimized, responsive, metadata', async () => {
    cloudinary.url.mockReturnValue('https://cdn/variant');
    uploadBuffer.mockResolvedValue('https://cdn/manawa/avatars/abc123.jpg');

    const result = await CDNHelper.uploadWithOptimization(Buffer.from('data'), 'manawa/avatars');

    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('publicId');
    expect(result).toHaveProperty('optimized');
    expect(result).toHaveProperty('responsive');
    expect(result).toHaveProperty('metadata');
    expect(result.metadata).toHaveProperty('folder', 'manawa/avatars');
    expect(result.metadata).toHaveProperty('uploadedAt');
  });

  it('inclut le tag "manawa" par défaut sans options personnalisées', async () => {
    cloudinary.url.mockReturnValue('https://cdn/url');
    uploadBuffer.mockResolvedValue('https://cdn/manawa/x.jpg');

    await CDNHelper.uploadWithOptimization(Buffer.from('d'), 'manawa/x');

    const callOpts = uploadBuffer.mock.calls[0][2];
    expect(callOpts.tags).toContain('manawa');
  });

  it('passe les tags personnalisés via options', async () => {
    cloudinary.url.mockReturnValue('https://cdn/url');
    uploadBuffer.mockResolvedValue('https://cdn/manawa/x.jpg');

    await CDNHelper.uploadWithOptimization(Buffer.from('d'), 'manawa/x', { tags: ['custom-tag'] });

    const callOpts = uploadBuffer.mock.calls[0][2];
    // options.tags est passé via spread options — custom-tag est présent dans le call
    expect(callOpts.tags).toContain('custom-tag');
  });

  it('enveloppe les erreurs uploadBuffer dans une erreur lisible', async () => {
    uploadBuffer.mockRejectedValue(new Error('Cloudinary down'));

    await expect(
      CDNHelper.uploadWithOptimization(Buffer.from('d'), 'folder')
    ).rejects.toThrow('Upload optimization failed: Cloudinary down');
  });
});

// ─── generateSignedUrl ────────────────────────────────────────────────────────

describe('CDNHelper.generateSignedUrl', () => {
  it('lève une erreur si publicId manquant', () => {
    expect(() => CDNHelper.generateSignedUrl('')).toThrow('Public ID is required');
  });

  it('appelle cloudinary.url avec sign_url: true', () => {
    cloudinary.url.mockReturnValue('https://cdn/signed');

    CDNHelper.generateSignedUrl('private-doc');

    const callArg = cloudinary.url.mock.calls[0][1];
    expect(callArg.sign_url).toBe(true);
  });

  it('utilise la config "default" si type non spécifié', () => {
    cloudinary.url.mockReturnValue('https://cdn/signed');

    CDNHelper.generateSignedUrl('doc-id');

    const callArg = cloudinary.url.mock.calls[0][1];
    expect(callArg.type).toBe('authenticated');
  });

  it('utilise la config "extended" si type = extended', () => {
    cloudinary.url.mockReturnValue('https://cdn/signed-extended');

    CDNHelper.generateSignedUrl('doc-id', 'extended');

    const callArg = cloudinary.url.mock.calls[0][1];
    expect(callArg.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 86000);
  });

  it('utilise la config "temporary" (5 min) si type = temporary', () => {
    cloudinary.url.mockReturnValue('https://cdn/tmp');

    const before = Math.floor(Date.now() / 1000);
    CDNHelper.generateSignedUrl('doc-id', 'temporary');
    const after = Math.floor(Date.now() / 1000);

    const callArg = cloudinary.url.mock.calls[0][1];
    expect(callArg.expires_at).toBeGreaterThanOrEqual(before + 300 - 1);
    expect(callArg.expires_at).toBeLessThanOrEqual(after + 300 + 1);
  });

  it('tombe en fallback sur "default" si type inconnu', () => {
    cloudinary.url.mockReturnValue('https://cdn/signed');

    CDNHelper.generateSignedUrl('doc-id', 'nonexistent');

    const callArg = cloudinary.url.mock.calls[0][1];
    expect(callArg.type).toBe(SIGNED_URL_CONFIG.default.type);
  });
});

// ─── deleteOldImages ──────────────────────────────────────────────────────────

describe('CDNHelper.deleteOldImages', () => {
  it('lève une erreur si publicIds n\'est pas un tableau', async () => {
    await expect(CDNHelper.deleteOldImages('not-array')).rejects.toThrow('Array of public IDs is required');
  });

  it('lève une erreur si tableau vide', async () => {
    await expect(CDNHelper.deleteOldImages([])).rejects.toThrow('Array of public IDs is required');
  });

  it('appelle delete_resources avec les IDs', async () => {
    cloudinary.api.delete_resources.mockResolvedValue({ deleted: { 'img-1': 'deleted' } });

    const ids = ['img-1', 'img-2', 'img-3'];
    await CDNHelper.deleteOldImages(ids);

    expect(cloudinary.api.delete_resources).toHaveBeenCalledWith(ids);
  });

  it('traite en batches de 100 si plus de 100 IDs', async () => {
    cloudinary.api.delete_resources.mockResolvedValue({ deleted: {} });

    const ids = Array.from({ length: 150 }, (_, i) => `img-${i}`);
    await CDNHelper.deleteOldImages(ids);

    expect(cloudinary.api.delete_resources).toHaveBeenCalledTimes(2);
  });

  it('retourne un objet avec success, deleted, results, timestamp', async () => {
    cloudinary.api.delete_resources.mockResolvedValue({ deleted: { 'img-1': 'deleted' } });

    const result = await CDNHelper.deleteOldImages(['img-1']);

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(1);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.timestamp).toBeDefined();
  });

  it('enveloppe les erreurs API dans un message lisible', async () => {
    cloudinary.api.delete_resources.mockRejectedValue(new Error('Rate limit exceeded'));

    await expect(CDNHelper.deleteOldImages(['img-1'])).rejects.toThrow('Image deletion failed: Rate limit exceeded');
  });
});

// ─── deleteByTag ──────────────────────────────────────────────────────────────

describe('CDNHelper.deleteByTag', () => {
  it('lève une erreur si tag manquant', async () => {
    await expect(CDNHelper.deleteByTag('')).rejects.toThrow('Tag is required');
    await expect(CDNHelper.deleteByTag(null)).rejects.toThrow('Tag is required');
  });

  it('appelle delete_resources_by_tag avec le bon tag', async () => {
    cloudinary.api.delete_resources_by_tag.mockResolvedValue({
      deleted_resources: ['img-1', 'img-2'],
    });

    await CDNHelper.deleteByTag('old-2024');

    expect(cloudinary.api.delete_resources_by_tag).toHaveBeenCalledWith(
      'old-2024',
      { max_results: 100 }
    );
  });

  it('utilise le limit personnalisé', async () => {
    cloudinary.api.delete_resources_by_tag.mockResolvedValue({ deleted_resources: [] });

    await CDNHelper.deleteByTag('tag', 50);

    expect(cloudinary.api.delete_resources_by_tag).toHaveBeenCalledWith('tag', { max_results: 50 });
  });

  it('retourne success, deleted, resources, timestamp', async () => {
    cloudinary.api.delete_resources_by_tag.mockResolvedValue({
      deleted_resources: ['r1', 'r2'],
    });

    const result = await CDNHelper.deleteByTag('mytag');

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(2);
    expect(result.resources).toEqual(['r1', 'r2']);
    expect(result.timestamp).toBeDefined();
  });

  it('enveloppe l\'erreur dans un message lisible', async () => {
    cloudinary.api.delete_resources_by_tag.mockRejectedValue(new Error('Unauthorized'));

    await expect(CDNHelper.deleteByTag('tag')).rejects.toThrow('Tag-based deletion failed: Unauthorized');
  });
});

// ─── getUsageStats ────────────────────────────────────────────────────────────

describe('CDNHelper.getUsageStats', () => {
  it('retourne les statistiques formatées', async () => {
    cloudinary.api.usage.mockResolvedValue({
      transformations: 5000,
      credits_used: 100,
      credits_limit: 500,
      requests: 12000,
      bandwidth: 1073741824, // 1 GB
      storage: 2147483648,   // 2 GB
      resources_count: 350,
    });

    const result = await CDNHelper.getUsageStats();

    expect(result.transformations).toBe(5000);
    expect(result.credits.used).toBe(100);
    expect(result.credits.limit).toBe(500);
    expect(result.bandwidth.used_gb).toBe('1.00');
    expect(result.storage.used_gb).toBe('2.00');
    expect(result.resources).toBe(350);
    expect(result.timestamp).toBeDefined();
  });

  it('enveloppe les erreurs', async () => {
    cloudinary.api.usage.mockRejectedValue(new Error('API unavailable'));

    await expect(CDNHelper.getUsageStats()).rejects.toThrow('Failed to fetch usage stats: API unavailable');
  });
});

// ─── listResources ────────────────────────────────────────────────────────────

describe('CDNHelper.listResources', () => {
  it('lève une erreur si folder manquant', async () => {
    await expect(CDNHelper.listResources('')).rejects.toThrow('Folder is required');
  });

  it('appelle cloudinary.api.resources avec le bon prefix', async () => {
    cloudinary.api.resources.mockResolvedValue({
      resources: [],
      total_count: 0,
      next_cursor: null,
    });

    await CDNHelper.listResources('manawa/avatars');

    expect(cloudinary.api.resources).toHaveBeenCalledWith({
      type: 'upload',
      prefix: 'manawa/avatars',
      max_results: 50,
    });
  });

  it('retourne resources mappées avec publicId, url, etc.', async () => {
    cloudinary.api.resources.mockResolvedValue({
      resources: [
        {
          public_id: 'manawa/avatars/user1',
          secure_url: 'https://cdn/user1.jpg',
          type: 'upload',
          created_at: '2026-01-01',
          bytes: 50000,
          tags: ['manawa'],
        },
      ],
      total_count: 1,
      next_cursor: null,
    });

    const result = await CDNHelper.listResources('manawa/avatars');

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].publicId).toBe('manawa/avatars/user1');
    expect(result.resources[0].url).toBe('https://cdn/user1.jpg');
    expect(result.total).toBe(1);
  });

  it('enveloppe les erreurs', async () => {
    cloudinary.api.resources.mockRejectedValue(new Error('Folder not found'));

    await expect(CDNHelper.listResources('bad/folder')).rejects.toThrow('Failed to list resources: Folder not found');
  });
});

// ─── getImageMetadata ─────────────────────────────────────────────────────────

describe('CDNHelper.getImageMetadata', () => {
  it('lève une erreur si publicId manquant', async () => {
    await expect(CDNHelper.getImageMetadata('')).rejects.toThrow('Public ID is required');
  });

  it('retourne les métadonnées enrichies', async () => {
    cloudinary.api.resource.mockResolvedValue({
      public_id: 'manawa/img1',
      format: 'jpg',
      width: 800,
      height: 400,
      bytes: 120000,
      created_at: '2026-01-01',
      tags: ['manawa'],
      secure_url: 'https://cdn/img1.jpg',
    });

    const result = await CDNHelper.getImageMetadata('manawa/img1');

    expect(result.publicId).toBe('manawa/img1');
    expect(result.format).toBe('jpg');
    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
    expect(result.aspectRatio).toBe('2.00');
    expect(result.url).toBe('https://cdn/img1.jpg');
  });

  it('enveloppe les erreurs', async () => {
    cloudinary.api.resource.mockRejectedValue(new Error('Not found'));

    await expect(CDNHelper.getImageMetadata('missing')).rejects.toThrow('Failed to fetch metadata: Not found');
  });
});

// ─── generateChainedTransformation ───────────────────────────────────────────

describe('CDNHelper.generateChainedTransformation', () => {
  it('lève une erreur si publicId manquant', () => {
    expect(() => CDNHelper.generateChainedTransformation('', [{ width: 100 }])).toThrow('Public ID is required');
  });

  it('lève une erreur si transformations vide ou non-tableau', () => {
    expect(() => CDNHelper.generateChainedTransformation('img', [])).toThrow('Transformations array is required');
    expect(() => CDNHelper.generateChainedTransformation('img', null)).toThrow('Transformations array is required');
  });

  it('appelle cloudinary.url avec transformation chainée', () => {
    cloudinary.url.mockReturnValue('https://cdn/chained');

    const transforms = [{ width: 400, crop: 'fill' }, { radius: 20 }];
    CDNHelper.generateChainedTransformation('img-id', transforms);

    expect(cloudinary.url).toHaveBeenCalledWith(
      'img-id',
      expect.objectContaining({
        secure: true,
        transformation: transforms,
      })
    );
  });

  it('retourne l\'URL', () => {
    cloudinary.url.mockReturnValue('https://cdn/chained-url');
    const result = CDNHelper.generateChainedTransformation('img', [{ width: 100 }]);
    expect(result).toBe('https://cdn/chained-url');
  });
});

// ─── getOptimalSettings ───────────────────────────────────────────────────────

describe('CDNHelper.getOptimalSettings', () => {
  it('retourne les paramètres par défaut sans deviceInfo', () => {
    const result = CDNHelper.getOptimalSettings();

    expect(result).toHaveProperty('format');
    expect(result).toHaveProperty('quality');
    expect(result).toHaveProperty('dpr', 'auto');
    expect(result).toHaveProperty('responsive', true);
  });

  it('retourne format "auto" si supportsWebP = true', () => {
    const result = CDNHelper.getOptimalSettings({ supportsWebP: true });
    expect(result.format).toBe('auto');
  });

  it('retourne format "jpg" si supportsWebP = false', () => {
    const result = CDNHelper.getOptimalSettings({ supportsWebP: false });
    expect(result.format).toBe('jpg');
  });

  it('retourne quality "auto:good" pour mobile', () => {
    const result = CDNHelper.getOptimalSettings({ isMobile: true });
    expect(result.quality).toBe('auto:good');
  });

  it('retourne quality "auto:best" pour desktop', () => {
    const result = CDNHelper.getOptimalSettings({ isMobile: false });
    expect(result.quality).toBe('auto:best');
  });

  it('retourne sizes "100vw" pour mobile', () => {
    const result = CDNHelper.getOptimalSettings({ isMobile: true });
    expect(result.sizes).toBe('100vw');
  });

  it('retourne sizes avec max-width pour desktop', () => {
    const result = CDNHelper.getOptimalSettings({ isMobile: false });
    expect(result.sizes).toContain('1200px');
  });
});

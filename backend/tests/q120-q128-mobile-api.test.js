// Tests Q120-Q128: Mobile API
// mobile-context.js, mobile-images.js, routes/mobile.js, index.js

const { mobileContextMiddleware } = require('../middleware/mobile-context');
const { getMobileImageUrl, optimizeImagesForMobile, MOBILE_PRESETS } = require('../config/mobile-images');
const fs = require('fs');
const path = require('path');

// ─── Q127 + Q128: Mobile context middleware ───────────────────────────────────

describe('Q127/Q128: mobileContextMiddleware', () => {
  function makeReq(headers = {}) {
    return { headers };
  }
  function makeRes() { return {}; }
  function makeNext() {
    let called = false;
    const fn = () => { called = true; };
    fn.wasCalled = () => called;
    return fn;
  }

  it('req.batterySaver = false par défaut', () => {
    const req = makeReq({});
    const next = makeNext();
    mobileContextMiddleware(req, makeRes(), next);
    expect(req.batterySaver).toBe(false);
    expect(next.wasCalled()).toBe(true);
  });

  it('req.batterySaver = true si X-Battery-Saver: true', () => {
    const req = makeReq({ 'x-battery-saver': 'true' });
    mobileContextMiddleware(req, makeRes(), makeNext());
    expect(req.batterySaver).toBe(true);
  });

  it('req.networkQuality = fast par défaut', () => {
    const req = makeReq({});
    mobileContextMiddleware(req, makeRes(), makeNext());
    expect(req.networkQuality).toBe('fast');
  });

  it('req.networkQuality = slow si X-Network-Quality: slow-2g', () => {
    const req = makeReq({ 'x-network-quality': 'slow-2g' });
    mobileContextMiddleware(req, makeRes(), makeNext());
    expect(req.networkQuality).toBe('slow');
  });

  it('req.networkQuality = slow si X-Network-Quality: 2g', () => {
    const req = makeReq({ 'x-network-quality': '2g' });
    mobileContextMiddleware(req, makeRes(), makeNext());
    expect(req.networkQuality).toBe('slow');
  });

  it('req.networkQuality = slow si X-Network-Quality: 3g', () => {
    const req = makeReq({ 'x-network-quality': '3g' });
    mobileContextMiddleware(req, makeRes(), makeNext());
    expect(req.networkQuality).toBe('slow');
  });

  it('req.networkQuality = fast si X-Network-Quality: 4g', () => {
    const req = makeReq({ 'x-network-quality': '4g' });
    mobileContextMiddleware(req, makeRes(), makeNext());
    expect(req.networkQuality).toBe('fast');
  });

  it('req.mobileOptimized = true si batterySaver', () => {
    const req = makeReq({ 'x-battery-saver': 'true' });
    mobileContextMiddleware(req, makeRes(), makeNext());
    expect(req.mobileOptimized).toBe(true);
  });

  it('req.mobileOptimized = true si réseau slow', () => {
    const req = makeReq({ 'x-network-quality': '2g' });
    mobileContextMiddleware(req, makeRes(), makeNext());
    expect(req.mobileOptimized).toBe(true);
  });

  it('req.mobileOptimized = false si réseau fast et pas battery saver', () => {
    const req = makeReq({ 'x-network-quality': '4g' });
    mobileContextMiddleware(req, makeRes(), makeNext());
    expect(req.mobileOptimized).toBe(false);
  });
});

// ─── Q126: Mobile image optimization ─────────────────────────────────────────

describe('Q126: getMobileImageUrl', () => {
  it('retourne null si publicId est null', () => {
    expect(getMobileImageUrl(null)).toBeNull();
  });

  it('retourne null si publicId est undefined', () => {
    expect(getMobileImageUrl(undefined)).toBeNull();
  });

  it('contient les paramètres Cloudinary de transformation', () => {
    const url = getMobileImageUrl('manawa/avatars/abc123', 'avatar');
    expect(url).toContain('w_150');
    expect(url).toContain('q_auto');
    expect(url).toContain('f_auto');
  });

  it('preset thumbnail utilise w_400', () => {
    const url = getMobileImageUrl('manawa/portfolio/xyz', 'thumbnail');
    expect(url).toContain('w_400');
  });

  it('preset profile utilise w_800', () => {
    const url = getMobileImageUrl('manawa/profile/xyz', 'profile');
    expect(url).toContain('w_800');
  });

  it('preset avatar utilise c_fill et g_face', () => {
    const url = getMobileImageUrl('manawa/avatars/xyz', 'avatar');
    expect(url).toContain('c_fill');
    expect(url).toContain('g_face');
  });

  it('extrait le publicId depuis une URL Cloudinary existante', () => {
    const cloudUrl = 'https://res.cloudinary.com/manawa/image/upload/v1234567890/manawa/avatars/abc123.jpg';
    const url = getMobileImageUrl(cloudUrl, 'thumbnail');
    expect(url).toContain('w_400');
    expect(url).toContain('manawa/avatars/abc123');
  });

  it('MOBILE_PRESETS contient avatar, thumbnail, profile, portfolio, banner', () => {
    expect(MOBILE_PRESETS).toHaveProperty('avatar');
    expect(MOBILE_PRESETS).toHaveProperty('thumbnail');
    expect(MOBILE_PRESETS).toHaveProperty('profile');
    expect(MOBILE_PRESETS).toHaveProperty('portfolio');
    expect(MOBILE_PRESETS).toHaveProperty('banner');
  });
});

describe('Q126: optimizeImagesForMobile', () => {
  it('transforme avatarUrl en URL mobile optimisée', () => {
    const obj = { id: '1', firstName: 'Kofi', avatarUrl: 'manawa/avatars/kofi' };
    const result = optimizeImagesForMobile(obj, 'avatar');
    expect(result.avatarUrl).toContain('w_150');
    expect(result.id).toBe('1');
  });

  it('ne modifie pas les champs non-image', () => {
    const obj = { id: '1', firstName: 'Kofi', city: 'Abidjan' };
    const result = optimizeImagesForMobile(obj);
    expect(result.city).toBe('Abidjan');
    expect(result.firstName).toBe('Kofi');
  });

  it('retourne null tel quel', () => {
    expect(optimizeImagesForMobile(null)).toBeNull();
  });

  it('retourne une chaîne telle quelle', () => {
    expect(optimizeImagesForMobile('texte')).toBe('texte');
  });

  it('traite les objets imbriqués (professional.photoUrl)', () => {
    const obj = {
      id: '1',
      professional: { id: 'p1', photoUrl: 'manawa/pro/photo' },
    };
    const result = optimizeImagesForMobile(obj, 'thumbnail');
    expect(result.professional.photoUrl).toContain('w_400');
  });
});

// ─── Q120: Routes mobiles batch ───────────────────────────────────────────────

describe('Q120: routes/mobile.js existe avec les bons endpoints', () => {
  const content = fs.readFileSync(path.join(__dirname, '../routes/mobile.js'), 'utf8');

  it('expose GET /dashboard', () => {
    expect(content).toContain("router.get('/dashboard'");
  });

  it('expose GET /notifications', () => {
    expect(content).toContain("router.get('/notifications'");
  });

  it('expose GET /profile-summary', () => {
    expect(content).toContain("router.get('/profile-summary'");
  });

  it('expose GET /sync', () => {
    expect(content).toContain("router.get('/sync'");
  });
});

// ─── Q121: Offline support — ETag + Cache-Control ────────────────────────────

describe('Q121: Offline-first support dans routes/mobile.js', () => {
  const content = fs.readFileSync(path.join(__dirname, '../routes/mobile.js'), 'utf8');

  it('positionne ETag sur /dashboard', () => {
    expect(content).toContain("setHeader('ETag'");
  });

  it('positionne Cache-Control private max-age', () => {
    expect(content).toContain('Cache-Control');
    expect(content).toContain('max-age=');
  });

  it('gère If-None-Match (304 Not Modified)', () => {
    expect(content).toContain('if-none-match');
    expect(content).toContain('304');
  });

  it('positionne Last-Modified', () => {
    expect(content).toContain('Last-Modified');
  });
});

// ─── Q122: Sync strategy ──────────────────────────────────────────────────────

describe('Q122: Sync strategy dans routes/mobile.js', () => {
  const content = fs.readFileSync(path.join(__dirname, '../routes/mobile.js'), 'utf8');

  it('endpoint /sync accepte le paramètre since', () => {
    expect(content).toContain('req.query.since');
  });

  it('valide que since est requis', () => {
    expect(content).toContain('"since" requis');
  });

  it('valide que since est une date valide', () => {
    expect(content).toContain('isNaN(since.getTime())');
  });

  it('retourne syncedAt dans la réponse', () => {
    expect(content).toContain('syncedAt');
  });
});

// ─── Q123: Conflict resolution ───────────────────────────────────────────────

describe('Q123: Conflict resolution dans routes/mobile.js', () => {
  const content = fs.readFileSync(path.join(__dirname, '../routes/mobile.js'), 'utf8');

  it('inclut conflictPolicy dans la réponse sync', () => {
    expect(content).toContain('conflictPolicy');
  });

  it('profile = last-write-wins', () => {
    expect(content).toContain("profile: 'last-write-wins'");
  });

  it('projects = server-wins', () => {
    expect(content).toContain("projects: 'server-wins'");
  });

  it('payments = server-wins', () => {
    expect(content).toContain("payments: 'server-wins'");
  });
});

// ─── Q124: Delta sync ────────────────────────────────────────────────────────

describe('Q124: Delta sync dans routes/mobile.js', () => {
  const content = fs.readFileSync(path.join(__dirname, '../routes/mobile.js'), 'utf8');

  it('filtre les notifications avec createdAt > since', () => {
    expect(content).toContain('createdAt: { gt: since }');
  });

  it('filtre les projets avec updatedAt > since', () => {
    expect(content).toContain('updatedAt: { gt: since }');
  });

  it('retourne les counts dans la réponse', () => {
    expect(content).toContain('counts:');
    expect(content).toContain('notifications.length');
    expect(content).toContain('projects.length');
  });

  it('retourne sinceUsed pour confirmer le timestamp utilisé', () => {
    expect(content).toContain('sinceUsed');
  });
});

// ─── Q125: Compression brotli ────────────────────────────────────────────────

describe('Q125: Brotli compression dans index.js', () => {
  const content = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

  it('utilise shrink-ray-current pour brotli + gzip', () => {
    expect(content).toContain('shrink-ray-current');
  });

  it('configure un threshold de compression', () => {
    expect(content).toContain('threshold:');
  });

  it('active brotli explicitement', () => {
    expect(content).toContain('brotli');
  });
});

// ─── Q120: Routes enregistrées dans index.js ─────────────────────────────────

describe('Q120: Enregistrement routes mobiles dans index.js', () => {
  const content = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

  it("importe routes/mobile.js", () => {
    expect(content).toContain("require('./routes/mobile')");
  });

  it("importe middleware/mobile-context.js", () => {
    expect(content).toContain("require('./middleware/mobile-context')");
  });

  it("monte /mobile sur apiV1Router", () => {
    expect(content).toContain("'/mobile'");
    expect(content).toContain('mobileRoutes');
  });

  it("applique mobileContextMiddleware globalement", () => {
    expect(content).toContain('mobileContextMiddleware');
  });
});

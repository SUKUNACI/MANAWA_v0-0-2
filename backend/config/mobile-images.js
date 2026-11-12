// Q126: Image size optimization for mobile via Cloudinary URL transformations
// Évite de télécharger des images full HD sur mobile (réduction 70-90% de bande passante)

const CLOUDINARY_BASE = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME || 'manawa'}/image/upload`;

const MOBILE_PRESETS = {
  avatar:    { w: 150, h: 150, c: 'fill', g: 'face' },
  thumbnail: { w: 400, h: 300, c: 'fill' },
  profile:   { w: 800, h: 600, c: 'limit' },
  portfolio: { w: 600, h: 450, c: 'limit' },
  banner:    { w: 1200, h: 400, c: 'fill' },
};

function getMobileImageUrl(publicIdOrUrl, preset = 'thumbnail', overrides = {}) {
  if (!publicIdOrUrl) return null;

  const basePreset = MOBILE_PRESETS[preset] || MOBILE_PRESETS.thumbnail;
  const params = { ...basePreset, ...overrides };

  const transformParts = [
    `w_${params.w}`,
    `h_${params.h}`,
    `c_${params.c}`,
    params.g ? `g_${params.g}` : null,
    'q_auto',
    'f_auto',
  ].filter(Boolean).join(',');

  // Si c'est déjà une URL Cloudinary, extraire le publicId et reconstruire
  if (publicIdOrUrl.includes('res.cloudinary.com')) {
    const match = publicIdOrUrl.match(/\/upload\/(?:v\d+\/)?(.+)$/);
    if (match) {
      const publicId = match[1].replace(/\.[^.]+$/, '');
      return `${CLOUDINARY_BASE}/${transformParts}/v1/${publicId}`;
    }
  }

  // Si c'est directement un publicId
  return `${CLOUDINARY_BASE}/${transformParts}/v1/${publicIdOrUrl}`;
}

// Transforme tous les champs *Url d'un objet en version mobile optimisée
function optimizeImagesForMobile(obj, preset = 'thumbnail') {
  if (!obj || typeof obj !== 'object') return obj;
  const result = Array.isArray(obj) ? [...obj] : { ...obj };

  const IMAGE_FIELDS = ['avatarUrl', 'photoUrl', 'imageUrl', 'coverUrl', 'thumbnailUrl', 'bannerUrl', 'profilePhotoUrl'];

  for (const key of Object.keys(result)) {
    if (IMAGE_FIELDS.includes(key) && result[key]) {
      result[key] = getMobileImageUrl(result[key], key === 'avatarUrl' ? 'avatar' : preset);
    } else if (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = optimizeImagesForMobile(result[key], preset);
    }
  }

  return result;
}

module.exports = { getMobileImageUrl, optimizeImagesForMobile, MOBILE_PRESETS };

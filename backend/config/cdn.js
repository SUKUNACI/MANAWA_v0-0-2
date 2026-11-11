const { v2: cloudinary } = require('cloudinary');

/**
 * Enhanced Cloudinary Configuration with Image Optimization
 * Provides production-ready CDN setup with automatic transformations
 */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Transformation presets for different use cases
 */
const TRANSFORMATIONS = {
  // Avatar/Profile pictures - 200x200, rounded, optimized
  avatar: {
    width: 200,
    height: 200,
    crop: 'fill',
    gravity: 'face',
    radius: 'max',
    quality: 'auto',
    fetch_format: 'auto',
  },

  // Thumbnail generation - 300x300 with auto-crop
  thumbnail: {
    width: 300,
    height: 300,
    crop: 'fill',
    gravity: 'auto',
    quality: 'auto',
    fetch_format: 'auto',
  },

  // Gallery images - 800x600, quality auto, responsive
  gallery: {
    width: 800,
    height: 600,
    crop: 'fill',
    quality: 'auto',
    fetch_format: 'auto',
    dpr: 'auto',
  },

  // Hero/Banner images - 1920x400
  hero: {
    width: 1920,
    height: 400,
    crop: 'fill',
    quality: 'auto',
    fetch_format: 'auto',
  },

  // Medium display - 600x400
  medium: {
    width: 600,
    height: 400,
    crop: 'fill',
    quality: 'auto',
    fetch_format: 'auto',
  },

  // Small display - 400x300
  small: {
    width: 400,
    height: 300,
    crop: 'fill',
    quality: 'auto',
    fetch_format: 'auto',
  },

  // Mobile-optimized - 375x280
  mobile: {
    width: 375,
    height: 280,
    crop: 'fill',
    quality: 'auto',
    fetch_format: 'auto',
  },

  // PDF preview - 400x500
  pdf_preview: {
    width: 400,
    height: 500,
    crop: 'fit',
    page: 1,
    quality: 'auto',
    fetch_format: 'jpg',
  },

  // Document display - 800x1000
  document: {
    width: 800,
    height: 1000,
    crop: 'fit',
    quality: 'auto',
    fetch_format: 'jpg',
  },

  // Video thumbnail - 800x450
  video_thumbnail: {
    width: 800,
    height: 450,
    crop: 'fill',
    gravity: 'auto',
    quality: 'auto',
    fetch_format: 'jpg',
  },

  // Responsive avatar set - multiple sizes
  avatar_responsive: [
    { width: 100, height: 100, crop: 'fill', gravity: 'face', radius: 'max', quality: 'auto', fetch_format: 'auto' },
    { width: 200, height: 200, crop: 'fill', gravity: 'face', radius: 'max', quality: 'auto', fetch_format: 'auto' },
    { width: 300, height: 300, crop: 'fill', gravity: 'face', radius: 'max', quality: 'auto', fetch_format: 'auto' },
  ],

  // Responsive gallery set - multiple sizes
  gallery_responsive: [
    { width: 300, height: 225, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' },
    { width: 600, height: 450, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' },
    { width: 900, height: 675, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' },
    { width: 1200, height: 900, crop: 'fill', gravity: 'auto', quality: 'auto', fetch_format: 'auto' },
  ],
};

/**
 * Folder structure for organized asset management
 */
const FOLDERS = {
  avatars: 'manawa/avatars',
  verification: 'manawa/verification',
  portfolio: 'manawa/portfolio',
  portfolio_projects: 'manawa/portfolio_projects',
  projects: 'manawa/projects',
  quotes: 'manawa/quotes',
  documents: 'manawa/documents',
  invoices: 'manawa/invoices',
  profiles: 'manawa/profiles',
  media: 'manawa/media',
  videos: 'manawa/videos',
  temp: 'manawa/temp',
};

/**
 * Video transcoding profiles for different streaming scenarios
 */
const VIDEO_PROFILES = {
  // HLS streaming - adaptive bitrate
  hls_streaming: {
    video_sampling: 5, // 5 fps for preview
    streaming_profile: 'hd',
    bit_rate: 'auto',
    fetch_format: 'mp4',
  },

  // Mobile preview - low bandwidth
  mobile_preview: {
    width: 640,
    height: 360,
    video_sampling: 5,
    bit_rate: '500k',
    quality: 'auto:low',
  },

  // Web preview - standard quality
  web_preview: {
    width: 1280,
    height: 720,
    video_sampling: 5,
    quality: 'auto',
  },
};

/**
 * Upload options with security and optimization settings
 */
const UPLOAD_OPTIONS = {
  // Standard image upload
  image: {
    resource_type: 'auto',
    quality: 'auto',
    eager: [], // Pre-transform on upload
    use_filename: true,
    unique_filename: true,
    overwrite: false,
    tags: ['manawa', 'uploaded'],
  },

  // Document upload (PDF, etc.)
  document: {
    resource_type: 'auto',
    type: 'authenticated',
    use_filename: true,
    unique_filename: true,
    overwrite: false,
    tags: ['manawa', 'document'],
  },

  // Video upload
  video: {
    resource_type: 'video',
    use_filename: true,
    unique_filename: true,
    overwrite: false,
    tags: ['manawa', 'video'],
  },

  // Temporary upload (auto-delete after 24h)
  temporary: {
    resource_type: 'auto',
    type: 'authenticated',
    use_filename: true,
    unique_filename: true,
    overwrite: false,
    eager_async: true,
    eager_notification_url: `${process.env.APP_URL || 'http://localhost:3000'}/webhooks/cloudinary`,
  },
};

/**
 * Caching headers configuration
 */
const CACHE_HEADERS = {
  // Long cache for versioned assets (1 year)
  versioned: {
    'Cache-Control': 'public, max-age=31536000, immutable',
  },

  // Medium cache for user content (30 days)
  content: {
    'Cache-Control': 'public, max-age=2592000, must-revalidate',
  },

  // Short cache for dynamic content (1 day)
  dynamic: {
    'Cache-Control': 'public, max-age=86400, must-revalidate',
  },

  // No cache for sensitive content
  private: {
    'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  },

  // Stale-while-revalidate strategy (7 days stale)
  stale_while_revalidate: {
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
  },
};

/**
 * Signed URL configuration for private/authenticated content
 */
const SIGNED_URL_CONFIG = {
  default: {
    type: 'authenticated',
    sign_url: true,
    expire: 3600, // 1 hour
  },
  extended: {
    type: 'authenticated',
    sign_url: true,
    expire: 86400, // 24 hours
  },
  temporary: {
    type: 'authenticated',
    sign_url: true,
    expire: 300, // 5 minutes for sensitive docs
  },
};

/**
 * Cloudinary account limits and monitoring
 */
const ACCOUNT_LIMITS = {
  maxUploadSize: 104857600, // 100MB
  maxBatchSize: 100,
  rateLimit: {
    perSecond: 10,
    perMinute: 500,
  },
  transformationChainLimit: 20,
};

/**
 * Cost optimization settings
 */
const OPTIMIZATION = {
  // Auto quality adjustment based on device
  autoQuality: true,

  // Auto format conversion (WebP, AVIF where supported)
  autoFormat: true,

  // Progressive image loading
  progressive: true,

  // Chroma subsampling for JPGs
  chromaSubsampling: true,

  // Strip metadata to reduce file size
  stripMetadata: true,

  // Adaptive delivery based on network
  adaptiveDelivery: true,

  // Quality settings
  quality: {
    auto: 'auto', // Cloudinary decides based on format
    high: 80,
    medium: 70,
    low: 60,
    thumbnail: 50,
  },
};

module.exports = {
  cloudinary,
  TRANSFORMATIONS,
  FOLDERS,
  VIDEO_PROFILES,
  UPLOAD_OPTIONS,
  CACHE_HEADERS,
  SIGNED_URL_CONFIG,
  ACCOUNT_LIMITS,
  OPTIMIZATION,
};

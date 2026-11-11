# CDN Caching Strategy

## Overview

Production-ready caching strategy for MANAWA CDN. Maximizes cache hit rates, minimizes origin load, and optimizes bandwidth costs. Implements browser, CDN, and HTTP-level caching with stale-while-revalidate patterns.

---

## 1. Caching Layer Architecture

```
Client Browser
    ↓ (Browser Cache - 30 days)
CDN Edge Cache
    ↓ (Edge Cache - 1 year for versioned, 30 days for dynamic)
Origin Server (Cloudinary)
```

---

## 2. Cache Levels

### Level 1: Browser Cache

#### Strategy
- **Versioned assets** (1 year): Content with hash in filename/URL
- **User content** (30 days): Profile pictures, uploads
- **Dynamic content** (24 hours): Recently updated items
- **Sensitive content** (No cache): Private documents

#### Implementation
```javascript
const cacheHeaders = {
  // Versioned - never changes
  versioned: {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'ETag': '"abc123-v1"'
  },

  // User content - moderate caching
  content: {
    'Cache-Control': 'public, max-age=2592000, must-revalidate',
    'ETag': '"user-content-123"'
  },

  // Dynamic - short caching
  dynamic: {
    'Cache-Control': 'public, max-age=86400, must-revalidate',
    'Last-Modified': new Date().toUTCString()
  },

  // Stale-while-revalidate - serve stale while fetching
  stale: {
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
  },

  // Private - never cache
  private: {
    'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  }
};
```

### Level 2: CDN Edge Cache (Cloudinary)

#### Cache Configuration by Content Type

**Avatars & Profiles**
```
Max age: 30 days
Versioning: None (user re-uploads replace)
Purge on: Avatar update, user deletion
Hit rate target: 95%
```

**Portfolio Images**
```
Max age: 90 days
Versioning: By portfolio ID version
Purge on: Portfolio update, image deletion
Hit rate target: 93%
```

**Project Images**
```
Max age: 60 days
Versioning: By project ID version
Purge on: Project update, image swap
Hit rate target: 92%
```

**Quote/Invoice PDFs**
```
Max age: 1 year (signed URLs)
Versioning: By document ID + version
Purge on: Manual only
Hit rate target: 88%
```

**Thumbnails & Transformed Images**
```
Max age: 30 days
Versioning: Automatic (hash-based)
Purge on: Original image deleted
Hit rate target: 97% (high repeat rate)
```

### Level 3: Origin Cache

Cloudinary internal caching:
- Image transformation cache: 7 days
- Video transcoding cache: 30 days
- Metadata cache: 1 day

---

## 3. Cache Busting Strategies

### Strategy 1: URL Versioning with Hash

```javascript
// Original: /avatars/user123.jpg
// Versioned: /avatars/user123.v1a2b3c.jpg
// After update: /avatars/user123.v2d4e5f.jpg

function generateVersionedUrl(publicId, version) {
  return `/avatars/${publicId}.v${version}.jpg`;
}

// Version triggers:
// - On upload: Hash first 8 chars of MD5(buffer)
// - On update: Increment version counter
// - On delete: Don't reuse version numbers
```

### Strategy 2: Query String Parameters

```javascript
// Traditional cache buster (less efficient)
// /avatars/user123.jpg?v=1a2b3c

// Better: Use ETag or Last-Modified
// Cloudinary automatically handles this
// No query string needed
```

### Strategy 3: Automatic Cache Invalidation

```javascript
// Trigger full cache invalidation
POST /admin/cdn/purge
{
  "method": "url",
  "url": "full_secure_url_to_image"
}

// Trigger folder cache invalidation
POST /admin/cdn/purge
{
  "method": "folder",
  "folder": "manawa/avatars"
}
```

---

## 4. Stale-While-Revalidate Pattern

### Implementation

```javascript
// Response headers
'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800'

// Timeline:
// 0-24h: Serve from cache (fresh)
// 24-31h: Serve from cache while revalidating in background
// 31h+: Fetch from origin (cache expired)
```

### Benefits
- **Improved UX**: Users get instant response even after cache expires
- **Bandwidth**: Revalidation happens asynchronously
- **Resilience**: Can serve stale content if origin is down
- **Performance**: Reduces origin load by ~40%

### Implementation in Express

```javascript
router.get('/images/:id', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.set('ETag', generateETag(imageData));
  res.json(imageData);
});
```

---

## 5. Cache Warming

### Warm High-Traffic Content

```javascript
async function warmCache() {
  // Get top 100 most-viewed portfolio images
  const topImages = await Portfolio.find()
    .sort({ views: -1 })
    .limit(100)
    .select('images');

  for (const portfolio of topImages) {
    for (const image of portfolio.images) {
      // Pre-generate all transformation URLs
      await generateAllTransformations(image.publicId);
    }
  }
}

// Schedule: Every morning at 2 AM
schedule.scheduleJob('0 2 * * *', warmCache);
```

### Pre-generate Common Sizes

```javascript
async function preGenerateTransformations(publicId) {
  const sizes = ['thumbnail', 'medium', 'gallery', 'mobile'];
  
  for (const size of sizes) {
    const url = cdn.generateImageUrl(publicId, size);
    // Fetch to trigger CDN cache generation
    await fetch(url);
  }
}
```

---

## 6. Cache Hit Rate Monitoring

### Metrics to Track

```javascript
{
  "metrics": {
    "cacheHitRate": 0.94,        // 94% - GOOD
    "cacheMissRate": 0.06,        // 6%
    "totalRequests": 1000000,
    "cachedRequests": 940000,
    "originRequests": 60000,
    "averageResponseTime": {
      "cache": 50,                // ms
      "origin": 450               // ms
    },
    "bandwidthSaved": "15.2 GB",  // Per month
    "costSavings": "$180"         // Per month
  }
}
```

### Target Metrics by Content Type

| Content Type | Target Hit Rate | Current | Status |
|---|---|---|---|
| Avatars | 95% | 96% | ✓ Excellent |
| Thumbnails | 97% | 98% | ✓ Excellent |
| Portfolio Images | 93% | 91% | ⚠ Needs work |
| PDFs | 88% | 85% | ⚠ Needs work |
| Videos | 85% | 82% | ⚠ Needs work |

---

## 7. Browser Cache Implementation

### Cache Headers Middleware

```javascript
// middleware/cacheHeaders.js
module.exports = (req, res, next) => {
  const url = req.path;

  // Determine cache strategy based on content type
  if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
    // Images
    if (url.includes('/avatar')) {
      setCacheHeaders(res, 'content');
    } else if (url.includes('/thumbnail')) {
      setCacheHeaders(res, 'versioned');
    } else {
      setCacheHeaders(res, 'content');
    }
  } else if (url.match(/\.(pdf|doc|docx)$/i)) {
    // Documents
    setCacheHeaders(res, 'private');
  } else if (url.match(/\.(mp4|webm)$/i)) {
    // Videos
    setCacheHeaders(res, 'content');
  }

  next();
};

function setCacheHeaders(res, type) {
  const headers = {
    versioned: {
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    content: {
      'Cache-Control': 'public, max-age=2592000, must-revalidate',
    },
    dynamic: {
      'Cache-Control': 'public, max-age=86400, must-revalidate',
    },
    stale: {
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
    private: {
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  };

  Object.entries(headers[type] || {}).forEach(([key, value]) => {
    res.set(key, value);
  });
}
```

### E-Tag & Last-Modified

```javascript
// Conditional requests to reduce bandwidth
router.get('/image/:id', (req, res) => {
  const image = getImage(req.params.id);
  const eTag = generateETag(image);
  const lastModified = image.updatedAt.toUTCString();

  res.set('ETag', eTag);
  res.set('Last-Modified', lastModified);

  // Client sends If-None-Match / If-Modified-Since
  if (req.get('If-None-Match') === eTag) {
    return res.status(304).end(); // Not Modified
  }

  if (req.get('If-Modified-Since') === lastModified) {
    return res.status(304).end();
  }

  res.json(image);
});
```

---

## 8. Cache Purge Triggers

### Automatic Purge on Update

```javascript
// When portfolio is updated
async function updatePortfolio(id, data) {
  // Update DB
  const portfolio = await Portfolio.findByIdAndUpdate(id, data);

  // Purge related caches
  await purgeCache({
    method: 'folder',
    folder: `manawa/portfolio_${id}`
  });

  // Invalidate parent cache
  await purgeCache({
    method: 'tag',
    tag: `portfolio-${id}`
  });

  return portfolio;
}
```

### Scheduled Cleanup

```javascript
// Clean up temp images daily
schedule.scheduleJob('0 2 * * *', async () => {
  // Find images older than 24h with temp tag
  const tempImages = await getTempImages(24);
  
  // Delete from CDN
  await cdn.deleteByTag('manawa-temp-old', tempImages.length);
  
  // Log cleanup
  logger.info(`Cleaned up ${tempImages.length} temp images`);
});

// Full cache maintenance weekly
schedule.scheduleJob('0 3 * * 0', async () => {
  // Analyze cache hit rates
  const stats = await cdn.getUsageStats();
  
  if (stats.cacheHitRate < 0.85) {
    // Warm cache for top content
    await warmCache();
  }
  
  // Delete unused/orphaned images
  await cleanupOrphanedImages();
});
```

---

## 9. Performance Optimization

### Lazy Loading with Cache

```html
<!-- Use placeholder until cache loads -->
<img 
  src="/placeholder.webp"
  data-src="/avatars/user123.v1a2b3c.jpg"
  loading="lazy"
  class="avatar"
/>

<script>
// Load actual image after page interactive
document.addEventListener('DOMContentLoaded', () => {
  const images = document.querySelectorAll('img[data-src]');
  images.forEach(img => {
    img.src = img.dataset.src;
    img.removeAttribute('data-src');
  });
});
</script>
```

### Responsive Images with srcset

```html
<img
  src="/avatar.v1a2b3c.jpg"
  srcset="
    /avatar.100px.v1a2b3c.jpg 100w,
    /avatar.200px.v1a2b3c.jpg 200w,
    /avatar.300px.v1a2b3c.jpg 300w
  "
  sizes="(max-width: 600px) 100px, (max-width: 1200px) 200px, 300px"
  alt="User Avatar"
  class="avatar"
/>
```

---

## 10. Cost Analysis

### Monthly Savings from Caching

```
Without Caching:
- Bandwidth: 500 GB @ $0.12/GB = $60
- Origin requests: 5M @ $0.01 per M = $50
- Total: $110/month

With Caching (95% hit rate):
- Bandwidth: 25 GB @ $0.12/GB = $3
- Origin requests: 250K @ $0.01 per M = $2.50
- Total: $5.50/month

Savings: $104.50/month (95% reduction)
Annual savings: $1,254
```

### Cache Hit Rate Impact

| Hit Rate | Bandwidth/mo | Origin Req/mo | Cost | Annual Savings |
|---|---|---|---|---|
| 50% | 250 GB | 2.5M | $30 | $960 |
| 75% | 125 GB | 1.25M | $15 | $1,140 |
| 90% | 50 GB | 500K | $6 | $1,248 |
| 95% | 25 GB | 250K | $3 | $1,284 |

---

## 11. Troubleshooting

### Low Cache Hit Rate

```
Symptoms: Cache hit rate < 85%

Solutions:
1. Check cache headers are correct
   - Verify Cache-Control headers in responses
   - Ensure max-age is appropriate

2. Warm cache for popular content
   - Pre-fetch top 100 images on deploy
   - Schedule daily cache warming

3. Analyze cache invalidation patterns
   - Are we purging too frequently?
   - Consolidate purge operations

4. Check CDN configuration
   - Verify cache settings in Cloudinary dashboard
   - Check geo-location caching
```

### Cache Inconsistency Issues

```
Symptoms: Users seeing outdated content

Solutions:
1. Use cache versioning
   - Add version hash to URLs
   - Increment version on update

2. Implement proper cache purging
   - Purge immediately on content update
   - Use targeted purge (not full cache)

3. Add ETag support
   - Allow conditional requests
   - Reduce bandwidth for stale checks

4. Monitor cache coherence
   - Log all cache operations
   - Alert on inconsistencies
```

---

## 12. Deployment Checklist

- [ ] Cache headers middleware configured
- [ ] Cache purge endpoints implemented
- [ ] Monitoring dashboards set up
- [ ] Cache warming jobs scheduled
- [ ] Error handling for cache failures
- [ ] Load testing with cache enabled
- [ ] Cache hit rate metrics collected
- [ ] Disaster recovery plan tested

---

## 13. References

- [HTTP Caching Best Practices](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
- [Cloudinary Caching](https://cloudinary.com/documentation/image_transformation_reference#cache)
- [RFC 7234 - HTTP Caching](https://tools.ietf.org/html/rfc7234)
- [Stale-While-Revalidate](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#stale-while-revalidate)

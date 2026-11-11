# CDN Deployment & Configuration Guide

## Overview

This document covers the complete CDN (Content Delivery Network) setup for MANAWA using Cloudinary as the primary provider. Includes image optimization, video transcoding, signed URLs, and cost optimization strategies.

---

## 1. Cloudinary Account Setup

### Prerequisites
- Cloudinary account (https://cloudinary.com)
- API credentials (Cloud Name, API Key, API Secret)
- Environment variables configured

### Environment Variables
```bash
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
APP_URL=https://api.manawa.com  # For webhooks
```

### Account Settings Configuration
1. **Security**: Enable "Require signed URLs" for authenticated content
2. **Upload presets**: Create named presets for different resource types
3. **Webhooks**: Configure for upload notifications and transcoding completion
4. **API limits**: Set rate limits and quota alerts

---

## 2. Image Optimization Strategy

### Transformation Presets

#### Avatar Optimization (200x200)
```javascript
{
  width: 200,
  height: 200,
  crop: 'fill',
  gravity: 'face',      // Smart crop on faces
  radius: 'max',        // Rounded avatars
  quality: 'auto',      // Adaptive quality
  fetch_format: 'auto'  // WebP on supported browsers
}
```
- **Use case**: User profiles, member listings
- **File size**: ~15-25 KB (JPEG), ~8-15 KB (WebP)
- **CDN cache**: 30 days

#### Gallery Optimization (800x600)
```javascript
{
  width: 800,
  height: 600,
  crop: 'fill',
  gravity: 'auto',      // ML-based smart crop
  quality: 'auto',
  fetch_format: 'auto',
  dpr: 'auto'           // Device pixel ratio
}
```
- **Use case**: Portfolio projects, project images
- **File size**: ~80-120 KB (JPEG), ~40-70 KB (WebP)
- **CDN cache**: 30 days

#### Mobile Optimization (375x280)
```javascript
{
  width: 375,
  height: 280,
  crop: 'fill',
  quality: 'auto',
  fetch_format: 'auto',
  dpr: 'auto'
}
```
- **Use case**: Mobile app displays, responsive layouts
- **File size**: ~25-40 KB
- **CDN cache**: 7 days

#### PDF Preview (400x500 - First Page)
```javascript
{
  width: 400,
  height: 500,
  crop: 'fit',
  page: 1,              // First page only
  quality: 'auto',
  fetch_format: 'jpg'   // Convert to image
}
```
- **Use case**: Quote PDFs, invoice previews
- **File size**: ~30-50 KB
- **CDN cache**: 30 days

### Responsive Image Sets

#### Avatar Responsive Set
```
Desktop (300x300): 1x
Tablet (200x200): 0.67x
Mobile (100x100): 0.33x
```

#### Gallery Responsive Set
```
Desktop (1200x900): Large screens
Tablet (600x450): Tablets
Mobile (300x225): Mobile devices
Thumbnail (150x112): Lazy-load placeholder
```

---

## 3. Video Transcoding & Delivery

### Video Upload Flow
```
Upload Video
    ↓
Cloudinary Ingestion
    ↓
Generate Thumbnails (Async)
    ↓
Transcode to HLS/MPEG-DASH (Async)
    ↓
Send Webhook Notification
    ↓
Update Database with URLs
```

### HLS Streaming Configuration
```javascript
{
  streaming_profile: 'hd',  // HD quality ladder
  video_codec: 'h264',
  audio_codec: 'aac',
  bit_rates: [500, 1000, 2000, 5000],  // kbps
  generate_transcoding_playlist: true
}
```

### Video Thumbnail Generation
```javascript
{
  resource_type: 'video',
  start_offset: '5s',        // Thumbnail at 5 seconds
  duration: '1s',
  video_sampling: 5,         // Extract every 5 frames
  width: 800,
  height: 450,
  fetch_format: 'jpg'
}
```

### Video Encoding Profiles

#### Mobile Preview (360p)
- Bitrate: 500 kbps
- Resolution: 640x360
- Use case: Mobile apps, preview
- Storage: ~250 MB/hour

#### Web Preview (720p)
- Bitrate: 1000 kbps
- Resolution: 1280x720
- Use case: Web browsers, standard devices
- Storage: ~450 MB/hour

#### HD Streaming (1080p)
- Bitrate: 2000 kbps
- Resolution: 1920x1080
- Use case: Desktop, high-bandwidth users
- Storage: ~900 MB/hour

---

## 4. Signed URLs for Private Content

### Use Cases
1. **Quote PDFs** - Download after authentication
2. **Invoice Documents** - Restricted access
3. **Verification Documents** - Temporary access
4. **Private Portfolio** - Time-limited viewing

### Signed URL Generation
```javascript
cloudinary.url(publicId, {
  secure: true,
  type: 'authenticated',
  sign_url: true,
  expires_at: Math.floor(Date.now() / 1000) + 3600  // 1 hour
})
```

### Expiration Strategy
```
- 1 hour: Quote download, sensitive documents
- 24 hours: Invoice viewing, extended access
- 5 minutes: Temporary download links
- 7 days: Portfolio access for collaborators
```

---

## 5. Transformation Chaining

### Complex Transformation Example
```javascript
// Smart avatar with blur + sepia for inactive users
[
  { width: 200, height: 200, crop: 'fill', gravity: 'face' },
  { effect: 'blur:300' },  // Blur effect
  { overlay: 'overlay_inactive' }  // Overlay for inactive
]
```

### Document Watermarking
```javascript
[
  { page: 1, width: 800, height: 1000, fetch_format: 'jpg' },
  { 
    overlay: {
      font_family: 'Arial',
      font_size: 50,
      text: 'CONFIDENTIAL',
      opacity: 0.3
    }
  }
]
```

---

## 6. CDN Purging Strategy

### Manual Purge Endpoints
```bash
POST /admin/cdn/purge
- By URL
- By tag
- By folder
- Full cache invalidation
```

### Automatic Purge Triggers
1. **After image update**: Delete old version + purge CDN
2. **After portfolio change**: Purge portfolio folder
3. **Scheduled cleanup**: Daily at 2 AM UTC
4. **Storage optimization**: Delete images >30 days old (if unused)

### Purge by Tag Example
```bash
# Purge all avatars uploaded today
POST /admin/cdn/purge
{
  "method": "tag",
  "tag": "manawa-avatar-2024-11-11"
}
```

---

## 7. Performance Monitoring

### Metrics to Track
1. **CDN Performance**
   - Cache hit rate (target: >90%)
   - Average response time (target: <200ms)
   - Bandwidth usage (monthly trends)

2. **Image Optimization**
   - Average file size reduction (target: 60-70% vs original)
   - Transformation success rate (target: 99.9%)
   - Most-used transformations

3. **Storage**
   - Total storage used (GB)
   - Cost per GB
   - Storage growth rate

4. **Bandwidth**
   - Monthly bandwidth usage
   - Peak bandwidth times
   - Bandwidth by transformation type

### Monitoring Endpoint
```bash
GET /admin/cdn/stats
Response:
{
  "usage": {
    "bandwidth": "15.5 GB",
    "storage": "25.3 GB",
    "transformations": 450000,
    "resources": 5000
  },
  "costs": {
    "monthly": "$85.50",
    "bandwidth": "$12.00",
    "storage": "$5.00",
    "overage": "$0"
  },
  "performance": {
    "cacheHitRate": 0.94,
    "avgResponseTime": 185,
    "uptimePercentage": 99.98
  }
}
```

---

## 8. Cost Optimization

### Bandwidth Savings Strategies

#### 1. Image Optimization
- **WebP conversion**: 30-40% file size reduction
- **Quality optimization**: Auto quality based on format
- **Lazy loading**: Defer image loading
- **Responsive images**: Serve optimal size for device

**Estimated savings**: 50-60% bandwidth reduction

#### 2. Format Conversion
```
Original JPEG: 500 KB
    ↓
Cloudinary optimized:
  - JPEG: 200 KB (60% reduction)
  - WebP: 120 KB (76% reduction)
  - AVIF: 100 KB (80% reduction)
```

#### 3. Smart Caching
- CDN edge caching: 1 year for versioned assets
- Browser caching: 30 days for user content
- Stale-while-revalidate: Serve stale while validating

#### 4. Storage Optimization
- Auto-delete temp uploads after 24h
- Archive old portfolio items (>1 year)
- Consolidate duplicate images

### Cost Reduction Timeline
- **Month 1**: Standard optimization (30-40% savings)
- **Month 2**: Advanced caching (additional 20-30% savings)
- **Month 3**: Cleanup & deduplication (additional 10% savings)
- **Ongoing**: Monitoring & tuning

---

## 9. Deployment Checklist

### Pre-Deployment
- [ ] Cloudinary account created and verified
- [ ] API credentials generated and secured
- [ ] Environment variables configured in production
- [ ] Upload presets created and tested
- [ ] Webhooks configured and tested
- [ ] Rate limits configured
- [ ] SSL/TLS enabled (always use secure: true)

### Post-Deployment
- [ ] Health checks passing (image upload/download)
- [ ] Performance metrics baseline established
- [ ] Monitoring alerts configured
- [ ] Backup strategy implemented
- [ ] Disaster recovery plan documented

### Monitoring Setup
- [ ] CloudWatch metrics enabled
- [ ] Uptime monitoring configured
- [ ] Error rate alerts set (>1% threshold)
- [ ] Bandwidth alerts set (>80% monthly limit)
- [ ] Cost alerts set (>110% monthly budget)

---

## 10. Troubleshooting

### Common Issues

#### 1. Slow Image Loading
```
Symptoms: Images taking >500ms to load
Solution:
- Check CDN cache hit rate (should be >90%)
- Verify transformation complexity
- Enable compression in browser headers
- Use lazy loading
```

#### 2. Large File Sizes
```
Symptoms: Images >200KB after optimization
Solution:
- Check if quality optimization is enabled
- Verify format conversion is working
- Check for unnecessary metadata
- Review transformation settings
```

#### 3. Video Transcoding Timeout
```
Symptoms: Videos not transcoded after 10 minutes
Solution:
- Check webhook configuration
- Verify API key has video transcoding permission
- Check video file size and bitrate
- Review Cloudinary job queue status
```

#### 4. Rate Limiting Issues
```
Symptoms: 429 Too Many Requests errors
Solution:
- Implement exponential backoff retry
- Batch operations (max 100 per request)
- Check for authentication issues
- Review account rate limit quota
```

---

## 11. Security Best Practices

### 1. API Key Management
- Never commit API keys to version control
- Rotate keys quarterly
- Use different keys for staging/production
- Restrict key permissions (upload only, not delete)

### 2. Signed URLs
- Always sign sensitive content URLs
- Use shortest practical expiration time
- Invalidate URLs after access if possible
- Audit all signed URL access

### 3. Upload Validation
- Validate file type (magic bytes, not just extension)
- Check file size limits (100 MB max)
- Scan for malware (optional: integrate with VirusTotal)
- Log all uploads for audit trail

### 4. Access Control
- Use authentication middleware for upload endpoints
- Implement role-based access control
- Audit all CDN operations
- Monitor for unusual access patterns

---

## 12. Disaster Recovery

### Backup Strategy
1. **Daily snapshots**: Export CDN manifest daily
2. **Redundancy**: Keep copies in S3 (cold storage)
3. **Versioning**: Maintain git history of transformations
4. **Documentation**: Backup all config in git

### Recovery Procedures
```
Scenario: Full CDN data loss

1. Trigger S3 recovery (automated)
2. Re-upload critical assets (prioritized)
3. Regenerate transformed variants
4. Verify URLs and CDN cache
5. Monitor for errors
```

---

## 13. Migration Guide (If Switching from Other CDN)

### Process
```
1. Parallel run (30 days):
   - New CDN: 10% of traffic
   - Old CDN: 90% of traffic
   - Monitor error rates and performance

2. Gradual migration (7 days):
   - New CDN: 100% of new uploads
   - Old CDN: Existing content
   - Cache warming for popular assets

3. Full cutover:
   - All traffic to Cloudinary
   - Archive old CDN
   - Cleanup legacy configuration
```

---

## References

- [Cloudinary Documentation](https://cloudinary.com/documentation)
- [Image Transformation API](https://cloudinary.com/documentation/image_transformation_reference)
- [Video API](https://cloudinary.com/documentation/video_transformation_reference)
- [Signed URLs](https://cloudinary.com/documentation/control_access_to_media#signed_urls)
- [Performance Best Practices](https://cloudinary.com/documentation/performance)

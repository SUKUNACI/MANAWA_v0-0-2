# CDN Deployment Verification Checklist

**Purpose**: Systematic verification of CDN setup  
**Timeline**: 2-3 hours for full implementation  
**Owner**: DevOps / Backend Lead  

---

## Phase 1: Configuration Setup (30 min)

### Environment Variables
- [ ] `CLOUDINARY_CLOUD_NAME` set in .env
- [ ] `CLOUDINARY_API_KEY` set in .env
- [ ] `CLOUDINARY_API_SECRET` set in .env
- [ ] `APP_URL` set correctly (for webhooks)
- [ ] All variables tested with `GET /admin/cdn/health`

### Core Files Verification
- [ ] `/config/cdn.js` exists and exports required objects
  - [ ] TRANSFORMATIONS contains 8+ presets
  - [ ] FOLDERS contains all asset folders
  - [ ] CACHE_HEADERS properly configured
  - [ ] OPTIMIZATION settings correct

- [ ] `/utils/cdn-helpers.js` exists with all methods
  - [ ] generateImageUrl()
  - [ ] generateThumbnail()
  - [ ] generateResponsiveSet()
  - [ ] uploadWithOptimization()
  - [ ] generateSignedUrl()
  - [ ] deleteOldImages()
  - [ ] getUsageStats()
  - [ ] getImageMetadata()
  - [ ] All helper methods work without errors

- [ ] `/routes/cdn-admin.js` exists with all endpoints
  - [ ] GET /admin/cdn/stats
  - [ ] GET /admin/cdn/health
  - [ ] GET /admin/cdn/transformations
  - [ ] GET /admin/cdn/resources
  - [ ] GET /admin/cdn/resource/:id
  - [ ] POST /admin/cdn/purge
  - [ ] DELETE /admin/cdn/resources
  - [ ] POST /admin/cdn/cleanup

---

## Phase 2: Integration (45 min)

### Application Setup
- [ ] Admin routes registered in `app.js`:
  ```javascript
  app.use('/admin/cdn', require('./routes/cdn-admin'));
  ```
- [ ] Authentication middleware applied to admin routes
- [ ] Role-based access control enforces admin-only access

### Upload Handler Updates
- [ ] At least one upload route uses `CDNHelper.uploadWithOptimization()`
  - [ ] User avatars route updated
  - [ ] Portfolio images route updated (if exists)
  - [ ] Other image upload routes updated

- [ ] Upload handlers return both:
  - [ ] Direct URL for display
  - [ ] Optimized variants (thumbnail, medium, large)
  - [ ] Responsive set (srcset + sizes)

### Cache Headers Middleware
- [ ] Middleware created: `/middleware/cache-headers.js`
- [ ] Cache headers applied to image responses
- [ ] Different cache times for different content types:
  - [ ] Versioned assets: 1 year
  - [ ] User content: 30 days
  - [ ] Dynamic content: 1 day
  - [ ] Private content: no-cache

- [ ] Middleware registered in `app.js` before routes

### Frontend Integration
- [ ] At least one template uses responsive images:
  ```html
  <img srcset="..." sizes="..." src="..." loading="lazy" />
  ```
- [ ] Old single-size image tags replaced with responsive sets
- [ ] Lazy loading attribute added to images

---

## Phase 3: Automated Jobs (15 min)

### Cache Cleanup Job
- [ ] Job created: `/jobs/cache-cleanup.js`
- [ ] Scheduled to run daily at 2 AM
- [ ] Removes images older than 24h with temp tag
- [ ] Logs cleanup results

### Cache Warming Job (Optional)
- [ ] Job created for popular content pre-caching
- [ ] Scheduled to run weekly or before peak hours
- [ ] Pre-generates common image sizes

### Jobs Registration
- [ ] Jobs loaded in `app.js`: `require('./jobs/cache-cleanup')`
- [ ] Jobs configured with correct schedule

---

## Phase 4: Testing (30 min)

### Health Checks
- [ ] CDN connectivity test passes:
  ```bash
  curl http://localhost:3000/admin/cdn/health
  ```
  Expected: `{ "status": "healthy", "cloudinary": { "connected": true } }`

- [ ] Cloudinary API connectivity verified
- [ ] Authentication credentials validated

### Image Upload Test
- [ ] Test file upload to avatar endpoint:
  ```bash
  curl -F "avatar=@image.jpg" \
    -H "Authorization: Bearer TOKEN" \
    http://localhost:3000/users/avatar
  ```
  Expected: Returns URL + optimized variants

- [ ] Response contains all required fields:
  - [ ] Direct URL
  - [ ] Thumbnail URL
  - [ ] Medium URL
  - [ ] Large URL
  - [ ] Responsive set (srcset + sizes)

- [ ] Image displays correctly in browser
- [ ] Image loads quickly (< 500ms)

### Admin Endpoints Test
- [ ] Stats endpoint returns usage data:
  ```bash
  curl -H "Authorization: Bearer ADMIN_TOKEN" \
    http://localhost:3000/admin/cdn/stats
  ```
  Expected: Returns usage, costs, recommendations

- [ ] Transformations endpoint lists presets:
  ```bash
  curl -H "Authorization: Bearer ADMIN_TOKEN" \
    http://localhost:3000/admin/cdn/transformations
  ```

- [ ] Cache config endpoint returns settings:
  ```bash
  curl -H "Authorization: Bearer ADMIN_TOKEN" \
    http://localhost:3000/admin/cdn/cache-config
  ```

### Purge Test
- [ ] Purge by folder works:
  ```bash
  curl -X POST \
    -H "Authorization: Bearer ADMIN_TOKEN" \
    -d '{"method": "folder", "folder": "manawa/avatars"}' \
    http://localhost:3000/admin/cdn/purge
  ```

- [ ] Purge returns success confirmation

### Authentication & Authorization
- [ ] Admin endpoints require authentication
- [ ] Admin endpoints require admin role
- [ ] Non-admin users get 403 Forbidden
- [ ] Upload endpoints require user authentication

---

## Phase 5: Performance Verification (20 min)

### Image Optimization
- [ ] Uploaded JPEG is smaller than original
  - [ ] JPEG reduction: > 50%
  - [ ] WebP reduction: > 70%
  - [ ] AVIF reduction: > 75%

- [ ] Thumbnail generation works
- [ ] Responsive set generation works
- [ ] Image quality is acceptable at all sizes

### Load Time Measurement
- [ ] First image load: < 2 seconds
- [ ] Cached image load: < 200ms
- [ ] Average response time: < 100ms

### Cache Headers Verification
```bash
# Check response headers
curl -I http://localhost:3000/image/avatar.jpg

# Should contain:
# Cache-Control: public, max-age=2592000, must-revalidate
# ETag: "xxx"
# Last-Modified: ...
```

- [ ] Cache-Control headers present
- [ ] ETag headers present
- [ ] Last-Modified headers present
- [ ] Correct max-age values

---

## Phase 6: Monitoring Setup (15 min)

### Logging
- [ ] Upload operations logged
- [ ] CDN errors logged
- [ ] Cache purge operations logged
- [ ] Health check results logged

### Metrics Collection
- [ ] Response time metrics collected
- [ ] Cache hit rate tracked
- [ ] Bandwidth usage tracked
- [ ] Error rate monitored

### Alerts Configuration
- [ ] Alert for cache hit rate < 85%
- [ ] Alert for response time > 200ms
- [ ] Alert for CDN errors > 1%
- [ ] Alert for bandwidth > 80% monthly

### Dashboard Setup
- [ ] Monitoring dashboard created or updated
- [ ] CDN stats visible to admin
- [ ] Real-time metrics available
- [ ] Cost trends visible

---

## Phase 7: Documentation & Handoff (10 min)

### Documentation
- [ ] [CDN_README.md](CDN_README.md) reviewed and complete
- [ ] [CDN_INTEGRATION_QUICK_START.md](CDN_INTEGRATION_QUICK_START.md) verified
- [ ] [CDN_STRATEGY_REPORT.md](CDN_STRATEGY_REPORT.md) accessible
- [ ] [infrastructure/cdn-deployment.md](infrastructure/cdn-deployment.md) comprehensive
- [ ] [infrastructure/caching-strategy.md](infrastructure/caching-strategy.md) complete

### Code Comments
- [ ] CDN helper functions documented
- [ ] Admin endpoints documented
- [ ] Configuration options explained
- [ ] Complex logic commented

### Team Handoff
- [ ] Team members trained on CDN setup
- [ ] Admin panel walkthrough completed
- [ ] Troubleshooting guide shared
- [ ] Contact person assigned for issues

---

## Phase 8: Production Deployment (Ongoing)

### Pre-Deployment
- [ ] All tests passing
- [ ] Error rate < 0.1%
- [ ] No console errors or warnings
- [ ] Load testing completed

### Deployment
- [ ] Deploy to staging first
- [ ] Monitor staging for 24 hours
- [ ] Verify all metrics in staging
- [ ] Deploy to production

### Post-Deployment (24 hours)
- [ ] All endpoints responding normally
- [ ] Image uploads working smoothly
- [ ] Cache hit rate > 85%
- [ ] Average response time < 100ms
- [ ] Error rate < 0.1%
- [ ] No spike in resource usage

### Post-Deployment (1 week)
- [ ] Cache hit rates stable at > 90%
- [ ] Response times consistently < 100ms
- [ ] Bandwidth savings visible (50%+)
- [ ] No degradation in image quality
- [ ] User reports positive
- [ ] Cleanup jobs running successfully

### Post-Deployment (1 month)
- [ ] Cost reduction verified
- [ ] Performance metrics stable
- [ ] Optimization recommendations implemented
- [ ] Fine-tuned quality settings
- [ ] Cache warming jobs optimized
- [ ] Monitoring alerts working correctly

---

## Troubleshooting Checklist

### If Health Check Fails
- [ ] Verify Cloudinary credentials in .env
- [ ] Check API key has correct permissions
- [ ] Verify internet connectivity to Cloudinary
- [ ] Check firewall/proxy settings
- [ ] Review error message for specifics

### If Uploads Fail
- [ ] Check file size < 100 MB
- [ ] Verify file type is allowed (JPEG, PNG, WebP, PDF)
- [ ] Check user authentication token
- [ ] Review error logs for details
- [ ] Test with admin account if user fails

### If Cache Not Working
- [ ] Verify Cache-Control headers present
- [ ] Check browser cache settings
- [ ] Clear browser cache and retry
- [ ] Verify cache timeout values
- [ ] Check for cache invalidation rules

### If Images Look Bad
- [ ] Review quality settings
- [ ] Check transformation preset settings
- [ ] Try different quality value (e.g., 'auto:best')
- [ ] Test with different image source
- [ ] Check for format conversion issues

### If Admin Endpoints Return 403
- [ ] Verify user has admin role
- [ ] Check authentication token validity
- [ ] Verify authorization middleware applied
- [ ] Review error logs for details
- [ ] Test with known admin account

---

## Sign-Off

When all items checked, deployment is complete:

**Deployment Date**: _______________  
**Verified By**: _______________  
**Reviewed By**: _______________  

### Final Verification
- [ ] All phases completed (1-8)
- [ ] All tests passing
- [ ] Performance targets met
- [ ] No outstanding issues
- [ ] Team trained and ready
- [ ] Documentation complete

### Go/No-Go Decision
- [ ] ✓ GO - Ready for production
- [ ] ✗ NO-GO - Issues remain (list below)

**Issues Remaining**:
```
1. 
2. 
3. 
```

---

## Post-Deployment Monitoring

### Daily (First Week)
- [ ] Check error logs daily
- [ ] Monitor upload success rate
- [ ] Verify cache hit rates
- [ ] Check for user reports

### Weekly
- [ ] Review performance metrics
- [ ] Analyze cache statistics
- [ ] Check bandwidth trends
- [ ] Optimize as needed

### Monthly
- [ ] Generate cost report
- [ ] Review performance trends
- [ ] Plan optimizations
- [ ] Update capacity forecast

---

**Deployment Checklist Version**: 1.0  
**Last Updated**: 2026-11-11  
**Next Review**: 2026-12-11  

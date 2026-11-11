# Queue System - Quick Reference Card

## 🚀 Quick Start

### Installation
```bash
cd backend
npm install bull redis ioredis  # Already done
```

### Start Redis
```bash
docker run -d -p 6379:6379 redis:7-alpine
# or: redis-server
```

### Start Backend
```bash
npm run dev
```

## 📋 Queue Types

| Queue | Purpose | Concurrency | Example |
|-------|---------|-------------|---------|
| **emails** | Send emails | 5 | Booking confirmations |
| **pdfs** | Generate PDFs | 2 | Quote PDFs |
| **analytics** | Calculate metrics | 1 | Daily stats |
| **payments** | Process payments | 3 | Payment confirmations |
| **badges** | Update badges | 2 | Badge recalculation |

## 💻 Code Examples

### Queue an Email
```javascript
const { emailQueue } = require('./config/queue');
const { createBookingConfirmationEmail } = require('./jobs/sendEmailJob');

await createBookingConfirmationEmail(emailQueue, {
  clientEmail: 'user@example.com',
  clientName: 'John Doe',
  professionalName: 'Jane Smith',
  date: '2024-12-15',
  time: '14:30',
  location: 'Paris',
  bookingId: 'BOOK_123'
});
```

### Queue a PDF
```javascript
const { pdfQueue } = require('./config/queue');
const { queueQuotePdf } = require('./jobs/generatePdfJob');

await queueQuotePdf(pdfQueue, quoteId, 'high'); // 'high', 'normal', or 'low'
```

### Queue Payment Processing
```javascript
const { paymentQueue } = require('./config/queue');
const { queuePaymentConfirmation } = require('./jobs/processPaymentJob');

await queuePaymentConfirmation(paymentQueue, paymentId, amount, transactionId);
```

### Queue Analytics
```javascript
const { analyticsQueue } = require('./config/queue');
const { scheduleDailyAnalytics } = require('./jobs/calculateAnalyticsJob');

await scheduleDailyAnalytics(analyticsQueue);
```

### Queue Badge Update
```javascript
const { badgesQueue } = require('./config/queue');
const { queueUserBadgeUpdate } = require('./jobs/updateBadgesJob');

await queueUserBadgeUpdate(badgesQueue, userId); // Update single user
// or queueGlobalBadgeUpdate(badgesQueue); // Update all
```

## 🔌 Admin Endpoints

All require ADMIN role. Prefix: `/api/admin/queues/`

### Monitoring
```
GET  /                           # All queue stats
GET  /emails                     # Specific queue
GET  /emails/jobs                # List jobs (status=waiting|active|completed|failed|delayed)
GET  /emails/jobs/123            # Job details
```

### Management
```
POST   /emails/retry             # Retry failed (body: {limit: 10})
POST   /emails/jobs/123/retry    # Retry specific job
DELETE /emails/jobs/123          # Remove job
POST   /emails/clean             # Clean old (body: {daysOld: 7})
POST   /emails/pause             # Stop processing
POST   /emails/resume            # Resume processing
```

## 📊 Queue Stats Response

```json
{
  "name": "emails",
  "active": 2,           // Currently processing
  "completed": 150,      // Finished successfully
  "failed": 5,           // Failed (can retry)
  "delayed": 0,          // Scheduled for later
  "waiting": 12,         // Queued
  "recentFailedJobs": 5,
  "timestamp": "2024-12-16T10:30:00Z"
}
```

## 🔄 Retry Configuration

- **Max attempts**: 3
- **Backoff**: Exponential (2s → 4s → 8s)
- **On failure**: Logged + visible in admin UI + manually retryable
- **Job lifetime**: 7 days (auto-cleaned)

## 📁 File Structure

```
backend/
├── config/queue.js              # Queue setup + utilities
├── jobs/
│   ├── workers.js               # Worker initialization
│   ├── sendEmailJob.js          # Email processor
│   ├── generatePdfJob.js        # PDF processor
│   ├── calculateAnalyticsJob.js # Analytics processor
│   ├── processPaymentJob.js     # Payment processor
│   └── updateBadgesJob.js       # Badge processor
├── routes/queues-admin.js       # Admin endpoints
└── index.js                      # Server integration
```

## 🌐 Integration Checklist

- [ ] Email sending on booking
  ```javascript
  // routes/bookings.js - After creating booking
  await createBookingConfirmationEmail(emailQueue, {...});
  ```

- [ ] PDF generation on quote
  ```javascript
  // routes/quotes.js - After creating quote
  await queueQuotePdf(pdfQueue, quote.id);
  ```

- [ ] Payment webhook processing
  ```javascript
  // routes/payments.js - In webhook handler
  await queuePaymentWebhook(paymentQueue, paymentId, status);
  ```

- [ ] Daily analytics cron
  ```javascript
  // In cron job - Daily at 2 AM UTC
  await scheduleDailyAnalytics(analyticsQueue);
  ```

- [ ] Badge updates after booking
  ```javascript
  // routes/bookings.js - After marking complete
  await queueUserBadgeUpdate(badgesQueue, userId);
  ```

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Jobs not processing | Check Redis: `redis-cli ping` |
| Queue backing up | Increase concurrency or check for errors |
| High failure rate | Review error logs in admin UI |
| Redis connection failed | Check REDIS_HOST/PORT/PASSWORD in .env |
| Out of memory | Run cleanup: `POST /api/admin/queues/:queue/clean` |

## 📈 Performance

| Operation | Before (sync) | After (async) |
|-----------|---------------|---------------|
| Send email | 1-2 sec | <50ms ✅ |
| Generate PDF | 500ms-2s | <50ms ✅ |
| Process payment | 1-3 sec | <50ms ✅ |
| Calculate analytics | 5-10 sec | <50ms ✅ |

## 🔗 Documentation Links

- [Full Integration Guide](QUEUE_INTEGRATION_GUIDE.md)
- [Code Examples](jobs/EXAMPLES.md)
- [System Summary](QUEUE_SYSTEM_SUMMARY.md)
- [Bull Docs](https://github.com/OptimalBits/bull)

## 🛠️ Common Tasks

### View all queues in dashboard
```bash
curl http://localhost:4000/api/admin/queues \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Retry all failed emails
```bash
curl -X POST http://localhost:4000/api/admin/queues/emails/retry \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}'
```

### Clean old jobs (7+ days)
```bash
curl -X POST http://localhost:4000/api/admin/queues/emails/clean \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"daysOld": 7}'
```

### Monitor in real-time (Redis CLI)
```bash
redis-cli
> MONITOR          # See all Redis commands
> KEYS bull:*      # List all queue keys
> LRANGE bull:emails:waiting 0 -1  # View waiting emails
```

## 🚨 Production Checklist

- [ ] Redis add-on added to Render
- [ ] REDIS_HOST, REDIS_PORT, REDIS_PASSWORD set in production
- [ ] Error monitoring enabled (Sentry/CloudWatch)
- [ ] Alerts set for high failure rates
- [ ] Job cleanup scheduled weekly
- [ ] Database indexes on queue-related fields
- [ ] Backup strategy for critical jobs
- [ ] Queue health monitoring dashboard

## 📞 Support

For issues:
1. Check logs: `npm run dev` (local) or Render logs (production)
2. Review admin UI: `/api/admin/queues`
3. Check Redis: `redis-cli`
4. Read guides: QUEUE_INTEGRATION_GUIDE.md or jobs/EXAMPLES.md

---

**Last Updated**: 2024-12-16 | **Version**: 1.0.0

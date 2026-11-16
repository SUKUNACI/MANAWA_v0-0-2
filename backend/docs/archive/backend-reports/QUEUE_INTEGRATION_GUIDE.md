# Job Queue Integration Guide

This guide explains how to integrate the Bull/Redis async job queue system into your API routes and business logic.

## Architecture Overview

The queue system consists of:
- **config/queue.js** - Redis connection and queue initialization
- **jobs/workers.js** - Job processor initialization
- **jobs/** - Individual job handlers (sendEmailJob, generatePdfJob, etc.)
- **routes/queues-admin.js** - Admin monitoring endpoints
- **index.js** - Server integration

## Environment Setup

Add these to your `.env`:

```env
# Redis Configuration (optional - defaults to localhost:6379)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password  # optional
```

## Queue Types

### 1. Email Queue (emailQueue)
**Concurrency**: 5 concurrent jobs

**Usage**:
```javascript
const { emailQueue } = require('./config/queue');
const { createBookingConfirmationEmail } = require('./jobs/sendEmailJob');

// Queue an email
await createBookingConfirmationEmail(emailQueue, {
  clientEmail: 'client@example.com',
  clientName: 'Jean Dupont',
  professionalName: 'Marie Martin',
  date: '2024-12-15',
  time: '14:30',
  location: 'Paris, 75001',
  bookingId: 'BOOK_123456'
});
```

### 2. PDF Queue (pdfQueue)
**Concurrency**: 2 concurrent jobs

**Usage**:
```javascript
const { pdfQueue } = require('./config/queue');
const { queueQuotePdf } = require('./jobs/generatePdfJob');

// Queue a quote PDF generation
await queueQuotePdf(pdfQueue, quoteId, 'high'); // priority: 'low', 'normal', 'high'
```

### 3. Analytics Queue (analyticsQueue)
**Concurrency**: 1 concurrent job (to avoid database stress)

**Usage**:
```javascript
const { analyticsQueue } = require('./config/queue');
const { scheduleDailyAnalytics } = require('./jobs/calculateAnalyticsJob');

// Schedule daily analytics (run at 2 AM UTC)
await scheduleDailyAnalytics(analyticsQueue);
```

### 4. Payment Queue (paymentQueue)
**Concurrency**: 3 concurrent jobs

**Usage**:
```javascript
const { paymentQueue } = require('./config/queue');
const { queuePaymentConfirmation, queuePaymentWebhook } = require('./jobs/processPaymentJob');

// Queue payment confirmation
await queuePaymentConfirmation(paymentQueue, paymentId, amount, transactionId);

// Queue webhook processing
await queuePaymentWebhook(paymentQueue, paymentId, 'CONFIRMED');
```

### 5. Badges Queue (badgesQueue)
**Concurrency**: 2 concurrent jobs

**Usage**:
```javascript
const { badgesQueue } = require('./config/queue');
const { queueUserBadgeUpdate, queueGlobalBadgeUpdate } = require('./jobs/updateBadgesJob');

// Queue badge update for a user
await queueUserBadgeUpdate(badgesQueue, userId);

// Queue global badge update (all professionals)
await queueGlobalBadgeUpdate(badgesQueue);
```

## Integration Points

### POST /api/bookings - Queue confirmation email

```javascript
// routes/bookings.js
const { emailQueue } = require('../config/queue');
const { createBookingConfirmationEmail } = require('../jobs/sendEmailJob');

router.post('/', async (req, res, next) => {
  try {
    // ... create booking logic ...
    
    const booking = await prisma.booking.create({ /* ... */ });
    
    // Queue confirmation email
    await createBookingConfirmationEmail(emailQueue, {
      clientEmail: booking.client.email,
      clientName: `${booking.client.firstName} ${booking.client.lastName}`,
      professionalName: `${booking.professional.user.firstName} ${booking.professional.user.lastName}`,
      date: booking.date.toLocaleDateString('fr-FR'),
      time: booking.time,
      location: booking.location,
      bookingId: booking.id
    });
    
    res.json({ success: true, booking });
  } catch (err) {
    next(err);
  }
});
```

### POST /api/quotes - Queue PDF generation

```javascript
// routes/quotes.js
const { pdfQueue } = require('../config/queue');
const { queueQuotePdf } = require('../jobs/generatePdfJob');

router.post('/', async (req, res, next) => {
  try {
    // ... create quote logic ...
    
    const quote = await prisma.quote.create({ /* ... */ });
    
    // Queue PDF generation
    await queueQuotePdf(pdfQueue, quote.id, 'normal');
    
    res.json({ success: true, quote, message: 'PDF en cours de génération' });
  } catch (err) {
    next(err);
  }
});
```

### POST /api/payments/webhook - Queue payment webhook

```javascript
// routes/payments.js (or webhook handler)
const { paymentQueue } = require('../config/queue');
const { queuePaymentWebhook } = require('../jobs/processPaymentJob');

router.post('/webhooks/geniuspay', async (req, res, next) => {
  try {
    const { transactionId, status } = req.body;
    
    // Find payment by transaction ID
    const payment = await prisma.payment.findUnique({
      where: { transactionId }
    });
    
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    // Queue webhook processing (don't wait for completion)
    queuePaymentWebhook(paymentQueue, payment.id, status).catch(err => {
      logger.error('Failed to queue payment webhook', { error: err.message });
    });
    
    // Return immediately to prevent webhook timeout
    res.json({ success: true, received: true });
  } catch (err) {
    next(err);
  }
});
```

### Cron: Daily analytics calculation

Add to a cron job (e.g., node-cron, pm2, or similar):

```javascript
// Run at 2 AM UTC every day
const { analyticsQueue } = require('./config/queue');
const { scheduleDailyAnalytics } = require('./jobs/calculateAnalyticsJob');

setInterval(async () => {
  try {
    await scheduleDailyAnalytics(analyticsQueue);
    logger.info('Daily analytics queued');
  } catch (err) {
    logger.error('Failed to queue daily analytics', { error: err.message });
  }
}, 24 * 60 * 60 * 1000); // Every 24 hours
```

Or using node-cron:

```javascript
const cron = require('node-cron');

// At 2 AM UTC every day
cron.schedule('0 2 * * *', async () => {
  const { scheduleDailyAnalytics } = require('./jobs/calculateAnalyticsJob');
  const { analyticsQueue } = require('./config/queue');
  
  try {
    await scheduleDailyAnalytics(analyticsQueue);
    logger.info('Daily analytics queued');
  } catch (err) {
    logger.error('Failed to queue daily analytics', { error: err.message });
  }
});
```

### After booking confirmation - Queue badge update

```javascript
// After booking is completed
const { badgesQueue } = require('../config/queue');
const { queueUserBadgeUpdate } = require('../jobs/updateBadgesJob');

// Update professional badges (experienced, responsive, etc.)
await queueUserBadgeUpdate(badgesQueue, professional.userId);
```

## Admin Endpoints

### View all queue statuses
```
GET /api/admin/queues
```

### View specific queue status
```
GET /api/admin/queues/emails
GET /api/admin/queues/pdfs
GET /api/admin/queues/analytics
GET /api/admin/queues/payments
GET /api/admin/queues/badges
```

### View jobs in a queue
```
GET /api/admin/queues/emails/jobs?status=waiting&limit=50&offset=0
```

Query parameters:
- `status`: 'active', 'completed', 'failed', 'delayed', 'waiting' (default: waiting)
- `limit`: 1-100 (default: 50)
- `offset`: 0+ (default: 0)

### View specific job details
```
GET /api/admin/queues/emails/jobs/12345
```

### Retry failed jobs
```
POST /api/admin/queues/emails/retry
Body: { "limit": 10 }
```

### Retry specific job
```
POST /api/admin/queues/emails/jobs/12345/retry
```

### Remove a job
```
DELETE /api/admin/queues/emails/jobs/12345
```

### Clean old jobs
```
POST /api/admin/queues/emails/clean
Body: { "daysOld": 7 }
```

### Pause queue
```
POST /api/admin/queues/emails/pause
```

### Resume queue
```
POST /api/admin/queues/emails/resume
```

## Job Data Structures

### Email Job
```javascript
{
  to: 'recipient@example.com',
  subject: 'Email Subject',
  htmlPart: '<html>...</html>',
  textPart: 'Plain text version',
  replyTo: 'reply@example.com', // optional
  metadata: { type: 'booking_confirmation', bookingId: '123' } // optional
}
```

### PDF Job
```javascript
{
  type: 'quote' | 'invoice' | 'booking_confirmation',
  quoteId: '123', // for quote type
  invoiceId: '456', // for invoice type
  bookingId: '789', // for booking_confirmation type
  metadata: { /* custom tracking data */ }
}
```

### Analytics Job
```javascript
{
  date: '2024-12-15T00:00:00Z', // optional, defaults to yesterday
  scope: 'daily' | 'weekly' | 'monthly',
  metadata: { scheduledAt: '2024-12-16T02:00:00Z' }
}
```

### Payment Job
```javascript
{
  type: 'confirmation' | 'webhook' | 'refund',
  paymentId: '123',
  amount: 9999, // for confirmation type
  transactionId: 'TXN_123', // for confirmation type
  status: 'CONFIRMED' | 'FAILED', // for webhook type
  metadata: { queuedAt: '2024-12-16T10:30:00Z' }
}
```

### Badge Job
```javascript
{
  type: 'all' | 'user',
  userId: '123', // for user type
  badgeType: 'verified' | 'top_rated' | 'experienced' | 'responsive' | 'quick_quote', // optional
  metadata: { queuedAt: '2024-12-16T10:30:00Z' }
}
```

## Retry Logic

All jobs are configured with:
- **Max retries**: 3 attempts
- **Backoff strategy**: Exponential (2s, 4s, 8s)
- **Lock duration**: 30 seconds
- **Stall detection**: After 2 stalls, mark as failed

Failed jobs are:
- Logged with full error details
- Visible in admin UI
- Can be manually retried
- Removed after 7 days

## Error Handling

All job processors handle errors gracefully:

```javascript
async function sendEmailJob(job) {
  try {
    // Job logic
  } catch (err) {
    logger.error('[sendEmailJob] Error', {
      jobId: job.id,
      error: err.message,
      stack: err.stack
    });
    throw err; // Retry with backoff
  }
}
```

## Monitoring & Debugging

### Check queue health in code:
```javascript
const { emailQueue, getQueueStats } = require('./config/queue');

const stats = await getQueueStats(emailQueue, 'emails');
console.log(stats);
// Output:
// {
//   name: 'emails',
//   active: 2,
//   completed: 150,
//   failed: 5,
//   delayed: 0,
//   waiting: 12,
//   timestamp: '2024-12-16T10:30:00Z'
// }
```

### Retry failed jobs programmatically:
```javascript
const { retryFailedJobs } = require('./config/queue');

const retried = await retryFailedJobs(emailQueue, 'emails', 10);
console.log(`Retried ${retried.length} jobs`);
```

### Clean old jobs:
```javascript
const { cleanOldJobs } = require('./config/queue');

const cleaned = await cleanOldJobs(emailQueue, 'emails', 7);
console.log(`Cleaned ${cleaned.completed} completed, ${cleaned.failed} failed jobs`);
```

## Redis Connection

The queue system requires Redis to be running. For development:

```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or locally
redis-server
```

For production on Render:
- Use Render's Redis add-on
- Set REDIS_HOST, REDIS_PORT, REDIS_PASSWORD in environment

## Best Practices

1. **Use queues for I/O operations**: Emails, PDFs, APIs, database analytics
2. **Don't queue CPU-intensive tasks**: Use workers in separate processes
3. **Keep job data small**: Serialize only IDs, not full objects
4. **Handle failures gracefully**: Don't rely on queue for critical operations
5. **Monitor queue health**: Check admin UI regularly
6. **Clean old jobs**: Run cleanup on a weekly basis
7. **Use priority**: Set 'high' priority for time-sensitive jobs
8. **Log everything**: Enable debug logging in development

## Troubleshooting

### Jobs not processing
1. Check Redis connection: `redis-cli ping` should return `PONG`
2. Check worker logs: Look for initialization errors
3. Check queue stats: Use `/api/admin/queues` endpoint
4. Restart workers: Restart the Node.js process

### Redis connection failed
1. Ensure Redis is running
2. Check REDIS_HOST, REDIS_PORT, REDIS_PASSWORD in .env
3. Test connection: `redis-cli -h HOST -p PORT`

### High job failure rate
1. Check job logs in admin UI
2. Review error messages
3. Check database connectivity
4. Review external API limits (Mailjet, etc.)

## References

- [Bull Documentation](https://github.com/OptimalBits/bull)
- [Redis Documentation](https://redis.io/docs/)
- [Node.js Job Queues Guide](https://nodejs.org/en/docs/guides/simple-task-queue/)

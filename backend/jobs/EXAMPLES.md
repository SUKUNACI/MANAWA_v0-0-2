# Job Queue Usage Examples

## Quick Start

### 1. Send Email (Booking Confirmation)

```javascript
// In routes/bookings.js
const { emailQueue } = require('../config/queue');
const { createBookingConfirmationEmail } = require('../jobs/sendEmailJob');

router.post('/api/bookings/confirm', requireAuth, async (req, res, next) => {
  try {
    // Create booking in database
    const booking = await prisma.booking.create({
      data: {
        // ... booking data
      },
      include: {
        client: true,
        professional: { include: { user: true } }
      }
    });

    // Queue confirmation email (non-blocking)
    await createBookingConfirmationEmail(emailQueue, {
      clientEmail: booking.client.email,
      clientName: booking.client.firstName,
      professionalName: booking.professional.user.firstName,
      date: booking.date.toLocaleDateString('fr-FR'),
      time: booking.time,
      location: booking.location,
      bookingId: booking.id
    });

    // Send immediate response
    res.json({ 
      success: true, 
      booking,
      message: 'Booking created and confirmation email queued'
    });
  } catch (err) {
    next(err);
  }
});
```

### 2. Generate Quote PDF

```javascript
// In routes/quotes.js
const { pdfQueue } = require('../config/queue');
const { queueQuotePdf } = require('../jobs/generatePdfJob');

router.post('/api/quotes', requireAuth, async (req, res, next) => {
  try {
    // Create quote
    const quote = await prisma.quote.create({
      data: {
        // ... quote data
      }
    });

    // Queue PDF generation (high priority)
    const job = await queueQuotePdf(pdfQueue, quote.id, 'high');

    res.json({
      success: true,
      quote,
      pdfJobId: job.id,
      message: 'Quote created, PDF generation started'
    });
  } catch (err) {
    next(err);
  }
});
```

### 3. Process Payment Confirmation

```javascript
// In routes/payments.js or webhook handler
const { paymentQueue } = require('../config/queue');
const { queuePaymentConfirmation } = require('../jobs/processPaymentJob');

router.post('/api/payments/confirm', requireAuth, async (req, res, next) => {
  try {
    const { paymentId, amount, transactionId } = req.body;

    // Queue payment processing
    const job = await queuePaymentConfirmation(paymentQueue, paymentId, amount, transactionId);

    // Return immediately - processing happens in background
    res.json({
      success: true,
      message: 'Payment confirmation queued',
      jobId: job.id
    });
  } catch (err) {
    next(err);
  }
});
```

### 4. Calculate Daily Analytics

```javascript
// In cron job or scheduled task
const { analyticsQueue } = require('../config/queue');
const { scheduleDailyAnalytics } = require('../jobs/calculateAnalyticsJob');

// Schedule at 2 AM UTC daily
const cron = require('node-cron');

cron.schedule('0 2 * * *', async () => {
  try {
    const job = await scheduleDailyAnalytics(analyticsQueue);
    console.log('Daily analytics queued:', job.id);
  } catch (err) {
    console.error('Failed to queue analytics:', err.message);
  }
});
```

### 5. Update Badges for User

```javascript
// After booking completion or review posted
const { badgesQueue } = require('../config/queue');
const { queueUserBadgeUpdate } = require('../jobs/updateBadgesJob');

// Update badges when professional completes booking
router.patch('/api/bookings/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const booking = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status: 'COMPLETED' },
      include: { professional: true }
    });

    // Queue badge update for professional
    const job = await queueUserBadgeUpdate(badgesQueue, booking.professional.userId);

    res.json({
      success: true,
      booking,
      badgeJobId: job.id,
      message: 'Booking completed, badges will be recalculated'
    });
  } catch (err) {
    next(err);
  }
});
```

## Advanced Examples

### 1. Custom Email with Fallback

```javascript
// Send email with fallback to database logging
const { emailQueue } = require('../config/queue');

async function sendCustomEmail(to, subject, htmlPart, textPart) {
  try {
    const job = await emailQueue.add(
      {
        to,
        subject,
        htmlPart,
        textPart,
        metadata: {
          type: 'custom_notification',
          sentAt: new Date().toISOString()
        }
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: true,
        removeOnFail: false
      }
    );

    return {
      queued: true,
      jobId: job.id
    };
  } catch (err) {
    // Fallback: log to database
    logger.error('Failed to queue email', { to, subject, error: err.message });
    
    return {
      queued: false,
      error: err.message,
      fallback: 'logged_to_database'
    };
  }
}
```

### 2. Batch Email Sending

```javascript
// Send emails to multiple recipients
const { emailQueue } = require('../config/queue');

async function sendBulkEmails(recipients, subject, htmlTemplate) {
  const jobs = await Promise.all(
    recipients.map(recipient =>
      emailQueue.add(
        {
          to: recipient.email,
          subject,
          htmlPart: htmlTemplate(recipient),
          textPart: 'Check email for details'
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true
        }
      )
    )
  );

  return {
    count: jobs.length,
    jobIds: jobs.map(j => j.id)
  };
}

// Usage
const recipients = [
  { email: 'user1@example.com', firstName: 'John' },
  { email: 'user2@example.com', firstName: 'Jane' }
];

await sendBulkEmails(recipients, 'Welcome!', (recipient) => 
  `<h1>Hello ${recipient.firstName}!</h1>`
);
```

### 3. Priority-based PDF Generation

```javascript
// Generate PDFs with different priorities
const { pdfQueue } = require('../config/queue');
const { queueQuotePdf } = require('../jobs/generatePdfJob');

async function queuePdfWithPriority(quoteId, urgency) {
  let priority = 'normal';
  
  if (urgency === 'immediate') priority = 'high';
  if (urgency === 'low') priority = 'low';

  const job = await queueQuotePdf(pdfQueue, quoteId, priority);

  return {
    jobId: job.id,
    priority,
    expectedWaitTime: priority === 'high' ? '< 1 min' : '< 5 min'
  };
}
```

### 4. Queue Health Monitoring

```javascript
// Check queue health and alert if issues
const { emailQueue, analyticsQueue, getQueueStats } = require('../config/queue');
const logger = require('../utils/logger');

async function monitorQueueHealth() {
  const queues = [
    { queue: emailQueue, name: 'emails' },
    { queue: analyticsQueue, name: 'analytics' }
  ];

  for (const { queue, name } of queues) {
    const stats = await getQueueStats(queue, name);
    
    // Alert if too many failures
    if (stats.failed > 50) {
      logger.warn(`Queue ${name} has ${stats.failed} failed jobs!`);
    }
    
    // Alert if queue backing up
    if (stats.waiting > 1000) {
      logger.warn(`Queue ${name} is backing up: ${stats.waiting} waiting jobs!`);
    }
  }
}

// Run every 5 minutes
setInterval(monitorQueueHealth, 5 * 60 * 1000);
```

### 5. Retry Failed Jobs Manually

```javascript
// Admin endpoint to retry failed jobs
router.post('/api/admin/queues/:queueName/retry-all', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const { queueName } = req.params;
    const { retryFailedJobs } = require('../config/queue');
    
    // Get queue instance
    const queues = {
      emails: require('../config/queue').emailQueue,
      pdfs: require('../config/queue').pdfQueue,
      payments: require('../config/queue').paymentQueue
    };

    const queue = queues[queueName];
    if (!queue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    const retried = await retryFailedJobs(queue, queueName, 100);

    res.json({
      success: true,
      retriedCount: retried.length,
      jobs: retried
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

### 6. Job Completion Tracking

```javascript
// Track job completion with webhook or callback
const { emailQueue } = require('../config/queue');

async function sendEmailWithTracking(to, subject, htmlPart, metadata) {
  const job = await emailQueue.add(
    { to, subject, htmlPart, metadata },
    { removeOnComplete: false, removeOnFail: false } // Keep for history
  );

  // Track completion
  job.on('completed', (result) => {
    logger.info('Email sent successfully', {
      jobId: job.id,
      to,
      result
    });
  });

  job.on('failed', (err) => {
    logger.error('Email failed', {
      jobId: job.id,
      to,
      error: err.message,
      attempts: job.attemptsMade
    });
  });

  return job;
}
```

### 7. Scheduled Analytics Calculation

```javascript
// Run analytics on specific schedule
const { analyticsQueue } = require('../config/queue');

async function scheduleAnalytics() {
  // Daily at 2 AM UTC
  const dailyJob = await analyticsQueue.add(
    {
      scope: 'daily',
      date: new Date().toISOString()
    },
    {
      repeat: { cron: '0 2 * * *', tz: 'UTC' }
    }
  );

  // Weekly on Monday at 3 AM UTC
  const weeklyJob = await analyticsQueue.add(
    {
      scope: 'weekly',
      date: new Date().toISOString()
    },
    {
      repeat: { cron: '0 3 * * 1', tz: 'UTC' }
    }
  );

  // Monthly on 1st at 4 AM UTC
  const monthlyJob = await analyticsQueue.add(
    {
      scope: 'monthly',
      date: new Date().toISOString()
    },
    {
      repeat: { cron: '0 4 1 * *', tz: 'UTC' }
    }
  );

  return { dailyJob, weeklyJob, monthlyJob };
}
```

## Testing Examples

```javascript
// Test queue with mock data
const { emailQueue } = require('../config/queue');

// Test: Queue email without Mailjet
describe('Email Queue', () => {
  it('should queue email successfully', async () => {
    const job = await emailQueue.add(
      {
        to: 'test@example.com',
        subject: 'Test',
        htmlPart: '<p>Test</p>',
        textPart: 'Test'
      }
    );

    expect(job.id).toBeDefined();
    expect(job.data.to).toBe('test@example.com');
  });

  it('should track job progress', async () => {
    const job = await emailQueue.add({
      to: 'test@example.com',
      subject: 'Test',
      htmlPart: '<p>Test</p>',
      textPart: 'Test'
    });

    const progress = job.progress();
    expect(typeof progress).toBe('number');
  });
});
```

## Performance Tips

1. **Batch operations**: Queue multiple emails together
2. **Use priorities**: Mark urgent jobs as high priority
3. **Monitor memory**: Set job limits and cleanup schedule
4. **Scale workers**: Increase concurrency for I/O-bound tasks
5. **Use Redis persistence**: Enable RDB or AOF for critical data

## Common Issues & Solutions

**Issue**: Jobs failing with "ECONNREFUSED"
- **Solution**: Check Redis is running: `redis-cli ping`

**Issue**: Queue backing up with waiting jobs
- **Solution**: Increase worker concurrency or check for bottlenecks

**Issue**: High memory usage
- **Solution**: Reduce `removeOnComplete` retention or cleanup old jobs

**Issue**: Webhook delivery too slow
- **Solution**: Queue webhook processing instead of processing synchronously

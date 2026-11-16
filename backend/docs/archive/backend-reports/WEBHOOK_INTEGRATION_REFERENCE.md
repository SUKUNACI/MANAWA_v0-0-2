# Webhook Integration Reference

This file lists exactly where and how to add webhook triggers to each route.

## Booking Events

### 1. booking.created

**Location**: `/routes/bookings.js` - POST handler
**Trigger Point**: After successful `prisma.booking.create()`
**Function**: `triggerBookingCreated(booking, client, professional)`

```javascript
const booking = await prisma.booking.create({
  data: {
    professionalId: req.body.professionalId,
    clientId: req.user.id,
    date: req.body.date,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    status: 'PENDING',
    projectId: req.body.projectId || null,
  },
  include: { professional: true, client: true },
});

// WEBHOOK TRIGGER - Add this
const { triggerBookingCreated } = require('../utils/webhook-triggers');
const client = await prisma.user.findUnique({ where: { id: booking.clientId } });
const professional = await prisma.user.findUnique({ where: { id: booking.professionalId } });
triggerBookingCreated(booking, client, professional).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.status(201).json({ success: true, data: booking });
```

---

### 2. booking.updated

**Location**: `/routes/bookings.js` - PATCH handler (status update)
**Trigger Point**: After `prisma.booking.update()` when status changes
**Function**: `triggerBookingUpdated(booking, client, professional, oldStatus)`

```javascript
const oldStatus = booking.status; // Save before update

const updated = await prisma.booking.update({
  where: { id: bookingId },
  data: { status: newStatus },
});

// WEBHOOK TRIGGER - Add this
if (oldStatus !== updated.status) {
  const { triggerBookingUpdated } = require('../utils/webhook-triggers');
  const client = await prisma.user.findUnique({ where: { id: updated.clientId } });
  const professional = await prisma.user.findUnique({ where: { id: updated.professionalId } });
  triggerBookingUpdated(updated, client, professional, oldStatus).catch(err => {
    logger.error('Webhook trigger failed', { error: err.message });
  });
}

res.json({ success: true, data: updated });
```

---

### 3. booking.cancelled

**Location**: `/routes/bookings.js` - DELETE handler
**Trigger Point**: After `prisma.booking.delete()`
**Function**: `triggerBookingCancelled(booking, client, professional, reason)`

```javascript
const booking = await prisma.booking.findUnique({
  where: { id: bookingId },
});

await prisma.booking.delete({
  where: { id: bookingId },
});

// WEBHOOK TRIGGER - Add this
const { triggerBookingCancelled } = require('../utils/webhook-triggers');
const client = await prisma.user.findUnique({ where: { id: booking.clientId } });
const professional = await prisma.user.findUnique({ where: { id: booking.professionalId } });
triggerBookingCancelled(booking, client, professional, req.body.cancelReason).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.json({ success: true, message: 'Booking cancelled' });
```

---

## Payment Events

### 4. payment.completed

**Location**: `/routes/finances.js` or payment handler
**Trigger Point**: After payment status confirmed as 'succeeded'
**Function**: `triggerPaymentCompleted(payment, quote, professional, client)`

```javascript
// Typically after GeniusPay webhook or payment confirmation
const payment = await prisma.payment.update({
  where: { id: paymentId },
  data: { status: 'succeeded', completedAt: new Date() },
});

// WEBHOOK TRIGGER - Add this
const { triggerPaymentCompleted } = require('../utils/webhook-triggers');
const quote = await prisma.quote.findUnique({
  where: { id: payment.quoteId },
  include: { project: true },
});
const professional = await prisma.professional.findUnique({
  where: { userId: quote.professionalId },
});
const client = await prisma.user.findUnique({
  where: { id: quote.project.clientId },
});

triggerPaymentCompleted(payment, quote, professional, client).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.json({ success: true, data: payment });
```

---

### 5. payment.failed

**Location**: `/routes/finances.js` or payment handler
**Trigger Point**: After payment status confirmed as 'failed'
**Function**: `triggerPaymentFailed(payment, quote, professional, client, failureReason)`

```javascript
const payment = await prisma.payment.update({
  where: { id: paymentId },
  data: { status: 'failed' },
});

// WEBHOOK TRIGGER - Add this
const { triggerPaymentFailed } = require('../utils/webhook-triggers');
const quote = await prisma.quote.findUnique({
  where: { id: payment.quoteId },
  include: { project: true },
});
const professional = await prisma.professional.findUnique({
  where: { userId: quote.professionalId },
});
const client = await prisma.user.findUnique({
  where: { id: quote.project.clientId },
});

const failureReason = req.body.reason || 'Payment processing failed';
triggerPaymentFailed(payment, quote, professional, client, failureReason).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.json({ success: true, data: payment });
```

---

## Quote Events

### 6. quote.created

**Location**: `/routes/quotes.js` - POST handler
**Trigger Point**: After `prisma.quote.create()`
**Function**: `triggerQuoteCreated(quote, professional, project, client)`

```javascript
const quote = await prisma.quote.create({
  data: {
    projectId: req.body.projectId,
    professionalId: req.user.professionalId,
    amount: req.body.amount,
    description: req.body.description,
    status: 'PENDING',
  },
});

// WEBHOOK TRIGGER - Add this
const { triggerQuoteCreated } = require('../utils/webhook-triggers');
const professional = await prisma.professional.findUnique({
  where: { userId: quote.professionalId },
  include: { user: true },
});
const project = await prisma.project.findUnique({
  where: { id: quote.projectId },
});
const client = await prisma.user.findUnique({
  where: { id: project.clientId },
});

triggerQuoteCreated(quote, professional, project, client).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.status(201).json({ success: true, data: quote });
```

---

### 7. quote.accepted

**Location**: `/routes/quotes.js` - PATCH handler (status to ACCEPTED)
**Trigger Point**: After quote status changes to 'ACCEPTED'
**Function**: `triggerQuoteAccepted(quote, professional, project, client)`

```javascript
const quote = await prisma.quote.update({
  where: { id: quoteId },
  data: { status: 'ACCEPTED' },
});

// WEBHOOK TRIGGER - Add this
const { triggerQuoteAccepted } = require('../utils/webhook-triggers');
const professional = await prisma.professional.findUnique({
  where: { userId: quote.professionalId },
  include: { user: true },
});
const project = await prisma.project.findUnique({
  where: { id: quote.projectId },
});
const client = await prisma.user.findUnique({
  where: { id: project.clientId },
});

triggerQuoteAccepted(quote, professional, project, client).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.json({ success: true, data: quote });
```

---

### 8. quote.refused

**Location**: `/routes/quotes.js` - PATCH handler (status to REFUSED)
**Trigger Point**: After quote status changes to 'REFUSED'
**Function**: `triggerQuoteRefused(quote, professional, project, client)`

```javascript
const quote = await prisma.quote.update({
  where: { id: quoteId },
  data: { status: 'REFUSED' },
});

// WEBHOOK TRIGGER - Add this
const { triggerQuoteRefused } = require('../utils/webhook-triggers');
const professional = await prisma.professional.findUnique({
  where: { userId: quote.professionalId },
  include: { user: true },
});
const project = await prisma.project.findUnique({
  where: { id: quote.projectId },
});
const client = await prisma.user.findUnique({
  where: { id: project.clientId },
});

triggerQuoteRefused(quote, professional, project, client).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.json({ success: true, data: quote });
```

---

## User Events

### 9. user.registered

**Location**: `/routes/auth.js` - POST /register handler
**Trigger Point**: After `prisma.user.create()` in registration
**Function**: `triggerUserRegistered(user)`

```javascript
const user = await prisma.user.create({
  data: {
    email,
    passwordHash,
    firstName,
    lastName,
    phone,
    role,
    city,
    emailVerifyCode,
    emailVerifyExpiry,
  },
});

// WEBHOOK TRIGGER - Add this
const { triggerUserRegistered } = require('../utils/webhook-triggers');
triggerUserRegistered(user).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.status(201).json({ success: true, data: { userId: user.id, email: user.email } });
```

---

### 10. user.verified

**Location**: `/routes/auth.js` - POST /verify-email handler
**Trigger Point**: After email verification successful
**Function**: `triggerUserVerified(user)`

```javascript
const user = await prisma.user.update({
  where: { id: userId },
  data: { emailVerified: true, emailVerifyCode: null, emailVerifyExpiry: null },
});

// WEBHOOK TRIGGER - Add this
const { triggerUserVerified } = require('../utils/webhook-triggers');
triggerUserVerified(user).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.json({ success: true, message: 'Email verified' });
```

---

## Project Events

### 11. project.created

**Location**: `/routes/projects.js` - POST handler
**Trigger Point**: After `prisma.project.create()`
**Function**: `triggerProjectCreated(project, client)`

```javascript
const project = await prisma.project.create({
  data: {
    clientId: req.user.id,
    title: req.body.title,
    description: req.body.description,
    tradeNeeded: req.body.tradeNeeded,
    budgetMin: req.body.budgetMin,
    budgetMax: req.body.budgetMax,
    city: req.body.city,
    latitude: req.body.latitude,
    longitude: req.body.longitude,
    status: 'OPEN',
  },
});

// WEBHOOK TRIGGER - Add this
const { triggerProjectCreated } = require('../utils/webhook-triggers');
const client = await prisma.user.findUnique({
  where: { id: project.clientId },
});

triggerProjectCreated(project, client).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.status(201).json({ success: true, data: project });
```

---

### 12. project.completed

**Location**: `/routes/projects.js` - PATCH handler (status to COMPLETED)
**Trigger Point**: After project status changes to 'COMPLETED'
**Function**: `triggerProjectCompleted(project, client)`

```javascript
const project = await prisma.project.update({
  where: { id: projectId },
  data: { status: 'COMPLETED' },
});

// WEBHOOK TRIGGER - Add this
const { triggerProjectCompleted } = require('../utils/webhook-triggers');
const client = await prisma.user.findUnique({
  where: { id: project.clientId },
});

triggerProjectCompleted(project, client).catch(err => {
  logger.error('Webhook trigger failed', { error: err.message });
});

res.json({ success: true, data: project });
```

---

## Import Pattern (Consistent Across All)

Add this import to each file that uses webhook triggers:

```javascript
const { 
  triggerBookingCreated,
  triggerBookingUpdated,
  triggerBookingCancelled,
  triggerPaymentCompleted,
  triggerPaymentFailed,
  triggerQuoteCreated,
  triggerQuoteAccepted,
  triggerQuoteRefused,
  triggerUserRegistered,
  triggerUserVerified,
  triggerProjectCreated,
  triggerProjectCompleted,
} = require('../utils/webhook-triggers');
```

## Error Handling Pattern

Always use this pattern to prevent webhook failures from breaking the API:

```javascript
triggerEventName(...args).catch(err => {
  logger.error('Webhook trigger failed', { 
    error: err.message,
    event: 'event.name',
    timestamp: new Date().toISOString(),
  });
  // Do NOT rethrow - webhooks should not break the API
});
```

## Testing Triggers

After adding each trigger, test it:

1. Create the resource in your app
2. Check admin panel: `GET /api/admin/webhooks/:webhookId/logs`
3. Verify event appears in logs with status "success"
4. Verify payload structure matches documentation

## Completion Checklist

- [ ] booking.created trigger added
- [ ] booking.updated trigger added
- [ ] booking.cancelled trigger added
- [ ] payment.completed trigger added
- [ ] payment.failed trigger added
- [ ] quote.created trigger added
- [ ] quote.accepted trigger added
- [ ] quote.refused trigger added
- [ ] user.registered trigger added
- [ ] user.verified trigger added
- [ ] project.created trigger added
- [ ] project.completed trigger added
- [ ] Retry cron job added to index.js
- [ ] All tests passing
- [ ] Manual testing completed
- [ ] Ready for production

## Common Issues

### Webhook not triggering?
- Verify function name is correct
- Check event exists in webhook subscription
- Ensure trigger is called after DB operation
- Check for errors in logs

### Trigger causing API error?
- Always use `.catch()` to prevent breaking the API
- Never `await` the trigger
- Never `return` the trigger promise

### Signature validation failing?
- Verify secret matches exactly
- Use raw JSON body, not parsed object
- Use `crypto.timingSafeEqual()` for comparison

## Production Considerations

1. **Retry Job**: Must run in production continuously
2. **Monitoring**: Alert if webhook failures exceed 10% in 5 minutes
3. **Cleanup**: Delete webhook logs older than 90 days
4. **Secrets**: Rotate webhook secrets regularly
5. **Rate Limiting**: Educate partners about rate limits

## Support

If a trigger isn't working:
1. Check `/utils/webhook-triggers.js` for exact function signature
2. Verify all required parameters are passed
3. Check webhook is active: `GET /api/admin/webhooks/:id`
4. Check logs: `GET /api/admin/webhooks/:id/logs`
5. Look for error messages in application logs

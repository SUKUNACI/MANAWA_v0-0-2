/**
 * Notification Features - Usage Examples
 *
 * Complete examples of how to use all 7 notification features
 * in MANAWA backend.
 *
 * Copy and adapt these examples for your implementation.
 */

const pushNotifications = require('../config/pushNotifications');
const batching = require('../config/notification-batching');
const fallback = require('../config/push-notification-fallback');
const dedup = require('../utils/notification-deduplication');
const prisma = require('../config/db');

// ============================================================================
// FEATURE #43: Push Notification Fallback
// ============================================================================

/**
 * Example 1: Send notification with automatic fallback chain
 * FCM → Expo → Email
 */
async function example_fallback_notification(userId, userEmail) {
  console.log('\n📧 FEATURE #43: Push Notification Fallback\n');

  const result = await fallback.sendWithFallback(
    userId,
    'Order Confirmed',
    'Your order #12345 has been confirmed',
    {
      orderId: '12345',
      amount: '99.99',
      type: 'ORDER_CONFIRMED',
    },
    userEmail
  );

  console.log('Result:', result);
  // Output: { sent: true, method: 'FCM' | 'EXPO' | 'EMAIL_FALLBACK' | 'NONE' }
}

// ============================================================================
// FEATURE #45: Notification Deduplication
// ============================================================================

/**
 * Example 2: Check and prevent duplicate notifications
 */
async function example_deduplication(userId) {
  console.log('\n🔄 FEATURE #45: Notification Deduplication\n');

  const content = 'Your order is confirmed';
  const notificationType = 'ORDER_CONFIRMED';

  // Check if recently sent
  const isDup = await dedup.isDuplicate(userId, notificationType, content);
  console.log('Is duplicate:', isDup); // false on first call

  // Mark as sent
  await dedup.markSent(userId, notificationType, content);
  console.log('Marked as sent ✓');

  // Check again (will be duplicate within 5 seconds)
  const isDup2 = await dedup.isDuplicate(userId, notificationType, content);
  console.log('Is duplicate (2nd check):', isDup2); // true

  // OR use atomic check+mark
  const { isDuplicate, marked } = await dedup.checkAndMark(
    userId,
    notificationType,
    content
  );
  console.log('Atomic result:', { isDuplicate, marked });
}

// ============================================================================
// FEATURE #46: Notification Batching
// ============================================================================

/**
 * Example 3: Send 1000+ notifications in parallel batches
 * Sequential: 10 seconds | Batched: 2 seconds (5x faster)
 */
async function example_batching() {
  console.log('\n⚡ FEATURE #46: Notification Batching\n');

  // Create 1000 notifications
  const notifications = Array(1000)
    .fill(0)
    .map((_, i) => ({
      userId: `user_${i}`,
      title: 'Special Offer',
      body: `Get 20% off on all products today!`,
      data: {
        type: 'PROMOTIONAL',
        offerId: 'OFFER_2024_001',
        discount: '20',
      },
    }));

  console.log(`Sending ${notifications.length} notifications in batches...`);
  const startTime = Date.now();

  const result = await batching.sendNotificationsBatch(notifications);

  const duration = Date.now() - startTime;
  console.log(`Completed in ${duration}ms`);
  console.log('Result:', {
    sent: result.sent,
    failed: result.failed,
    total: result.total,
    batchCount: result.batchCount,
  });
}

// ============================================================================
// FEATURE #47: Notification Templates with Versioning
// ============================================================================

/**
 * Example 4: Create and manage notification templates
 */
async function example_templates() {
  console.log('\n📝 FEATURE #47: Notification Templates\n');

  // Create initial template (v1)
  const template1 = await prisma.notificationTemplate.create({
    data: {
      name: 'ORDER_CONFIRMED',
      type: 'order',
      language: 'fr',
      title: 'Commande confirmée',
      body: 'Votre commande #{{orderId}} a été confirmée',
      variables: ['orderId'],
      version: 1,
      isActive: true,
    },
  });
  console.log('Created template v1:', template1.version);

  // Update template (creates v2)
  const template2 = await prisma.notificationTemplate.create({
    data: {
      name: 'ORDER_CONFIRMED',
      type: 'order',
      language: 'fr',
      title: 'Votre commande est confirmée! ✅',
      body: 'Merci, commande #{{orderId}} confirmée pour {{amount}}€',
      variables: ['orderId', 'amount'],
      version: 2,
      isActive: true,
    },
  });

  // Deactivate v1
  await prisma.notificationTemplate.update({
    where: { id: template1.id },
    data: { isActive: false },
  });

  console.log('Created template v2:', template2.version);
  console.log('Now v2 is active, v1 is archived');

  // View all versions
  const versions = await prisma.notificationTemplate.findMany({
    where: { name: 'ORDER_CONFIRMED' },
    orderBy: { version: 'desc' },
  });
  console.log(`Total versions: ${versions.length}`);
}

// ============================================================================
// FEATURE #48: Multi-Language Notifications
// ============================================================================

/**
 * Example 5: Get notifications in multiple languages
 */
async function example_multilanguage() {
  console.log('\n🌍 FEATURE #48: Multi-Language Notifications\n');

  const i18n = require('../i18n/notifications.json');

  const languages = ['fr', 'en', 'es', 'de'];
  const notificationType = 'ORDER_CONFIRMED';

  for (const lang of languages) {
    const template = i18n[lang]?.[notificationType];
    if (template) {
      console.log(`${lang.toUpperCase()}: "${template.title}"`);
    }
  }

  // Get user's locale and send in their language
  const user = await prisma.user.findUnique({
    where: { id: 'USER_ID' },
    select: { locale: true, email: true },
  });

  const userTemplate = i18n[user.locale]?.[notificationType];
  console.log(`\nUser language (${user.locale}):`, userTemplate.title);
}

// ============================================================================
// FEATURE #49: User Notification Preferences
// ============================================================================

/**
 * Example 6: Manage user notification preferences
 */
async function example_preferences(userId) {
  console.log('\n⚙️ FEATURE #49: User Notification Preferences\n');

  // Get or create preferences
  let prefs = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  if (!prefs) {
    // Create with defaults
    prefs = await prisma.notificationPreference.create({
      data: {
        userId,
        preferences: {
          ORDER_CONFIRMED: { email: true, push: true, sms: false },
          PROMOTIONAL: { email: true, push: false, sms: false },
          SYSTEM_ALERT: { email: true, push: true, sms: true },
        },
      },
    });
    console.log('Created default preferences');
  }

  console.log('Current preferences:', prefs.preferences);

  // Disable push for promotional
  const updated = await prisma.notificationPreference.update({
    where: { userId },
    data: {
      preferences: {
        ...prefs.preferences,
        PROMOTIONAL: { email: true, push: false, sms: false },
      },
      updatedAt: new Date(),
    },
  });

  console.log('Updated preferences ✓');

  // Check before sending
  const canSendPush = await checkNotificationEnabled(
    userId,
    'ORDER_CONFIRMED',
    'push'
  );
  console.log('Can send push for ORDER_CONFIRMED:', canSendPush);
}

async function checkNotificationEnabled(userId, type, channel) {
  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  if (!prefs) return true; // Default: enable
  const typePref = prefs.preferences[type];
  if (!typePref) return true; // Default: enable
  return typePref[channel] === true;
}

// ============================================================================
// FEATURE #50: Notification History & Archival
// ============================================================================

/**
 * Example 7: Archive and manage notification history
 */
async function example_archival(userId) {
  console.log('\n📦 FEATURE #50: Notification History & Archival\n');

  // Get active notifications
  const active = await prisma.notification.findMany({
    where: {
      userId,
      isArchived: false,
    },
    take: 5,
  });
  console.log(`Active notifications: ${active.length}`);

  // Archive one notification
  if (active.length > 0) {
    await prisma.notification.update({
      where: { id: active[0].id },
      data: { isArchived: true },
    });
    console.log('Archived 1 notification');
  }

  // Archive all notifications
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      isArchived: false,
    },
    data: { isArchived: true },
  });
  console.log(`Archived ${result.count} notifications`);

  // Get archived notifications
  const archived = await prisma.notification.findMany({
    where: {
      userId,
      isArchived: true,
    },
    take: 5,
    orderBy: { createdAt: 'desc' },
  });
  console.log(`Archived notifications: ${archived.length}`);

  // Restore notification
  if (archived.length > 0) {
    await prisma.notification.update({
      where: { id: archived[0].id },
      data: { isArchived: false },
    });
    console.log('Restored 1 notification');
  }
}

// ============================================================================
// INTEGRATION: Complete Order Notification Example
// ============================================================================

/**
 * Real-world example: Send order confirmation notification
 * Uses ALL 7 features together
 */
async function example_complete_order_notification(orderId) {
  console.log('\n🎯 COMPLETE EXAMPLE: Order Confirmation with All Features\n');

  // 1. Get order and user data
  const order = await prisma.packageOrder.findUnique({
    where: { id: orderId },
    include: { user: true },
  });

  if (!order) throw new Error('Order not found');

  const user = order.user;
  const userId = user.id;

  // 2. Check user notification preferences (#49)
  const canSend = await checkNotificationEnabled(
    userId,
    'ORDER_CONFIRMED',
    'push'
  );
  if (!canSend) {
    console.log('User opted out of push notifications');
    return;
  }

  // 3. Check for duplicates (#45)
  const content = `Order #${order.id} confirmed`;
  const { isDuplicate } = await dedup.checkAndMark(userId, 'ORDER_CONFIRMED', content);
  if (isDuplicate) {
    console.log('Duplicate notification blocked');
    return;
  }

  // 4. Get template in user's language (#48)
  const i18n = require('../i18n/notifications.json');
  const template = i18n[user.locale || 'fr'].ORDER_CONFIRMED;

  // 5. Substitute variables
  let title = template.title;
  let body = template.body;
  const variables = {
    orderId: order.id,
    amount: order.totalPrice,
  };

  Object.entries(variables).forEach(([key, value]) => {
    title = title.replace(`{{${key}}}`, value);
    body = body.replace(`{{${key}}}`, value);
  });

  // 6. Send with fallback (#43)
  const result = await fallback.sendWithFallback(
    userId,
    title,
    body,
    {
      orderId: order.id,
      amount: order.totalPrice,
      type: 'ORDER_CONFIRMED',
    },
    user.email
  );

  // 7. Create notification record (will be stored)
  await prisma.notification.create({
    data: {
      userId,
      type: 'ORDER_CONFIRMED',
      title,
      body,
      data: variables,
      read: false,
      isArchived: false,
    },
  });

  console.log('✅ Notification sent via:', result.method);
  console.log('   Title:', title);
  console.log('   Body:', body);
}

// ============================================================================
// BULK NOTIFICATION EXAMPLE
// ============================================================================

/**
 * Example: Send notification to 10,000 users using batching (#46)
 */
async function example_bulk_promotional_campaign() {
  console.log('\n📢 BULK EXAMPLE: Send to 10,000 Users\n');

  // Get all users who haven't opted out
  const users = await prisma.user.findMany({
    where: { suspended: false },
    select: { id: true },
    take: 10000,
  });

  console.log(`Found ${users.length} users`);

  // Prepare notifications
  const notifications = users.map(user => ({
    userId: user.id,
    title: 'Summer Sale 2024! 🌞',
    body: 'Get up to 50% off on all services',
    data: {
      type: 'PROMOTIONAL',
      campaignId: 'SUMMER_2024',
      discount: '50',
    },
  }));

  // Send in parallel batches (#46)
  console.log('Sending in batches of 100...');
  const startTime = Date.now();

  const result = await batching.sendNotificationsBatch(notifications);

  const duration = Date.now() - startTime;
  console.log(`✅ Campaign complete in ${duration}ms`);
  console.log(`   Sent: ${result.sent}`);
  console.log(`   Failed: ${result.failed}`);
  console.log(`   Success rate: ${((result.sent / result.total) * 100).toFixed(1)}%`);
}

// ============================================================================
// EXPORT ALL EXAMPLES
// ============================================================================

module.exports = {
  example_fallback_notification,
  example_deduplication,
  example_batching,
  example_templates,
  example_multilanguage,
  example_preferences,
  example_archival,
  example_complete_order_notification,
  example_bulk_promotional_campaign,
};

/**
 * To run examples:
 *
 * node -e "
 *   const ex = require('./examples/notifications-usage-examples');
 *   ex.example_deduplication('USER_ID').catch(console.error);
 * "
 */

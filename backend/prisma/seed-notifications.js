/**
 * Seed script for notification templates
 * Run with: node prisma/seed-notifications.js
 */

const { PrismaClient } = require('@prisma/client');
const i18n = require('../i18n/notifications.json');

const prisma = new PrismaClient();

async function seedNotificationTemplates() {
  try {
    console.log('🌱 Starting notification template seeding...\n');

    const languages = ['fr', 'en', 'es', 'de'];
    let created = 0;
    let skipped = 0;

    for (const language of languages) {
      const templates = i18n[language];

      for (const [name, template] of Object.entries(templates)) {
        // Extract notification type from name (e.g., ORDER_CONFIRMED -> order)
        const typeMap = {
          ORDER_CONFIRMED: 'order',
          ORDER_SHIPPED: 'order',
          ORDER_DELIVERED: 'order',
          ORDER_CANCELLED: 'order',
          PAYMENT_RECEIVED: 'payment',
          PAYMENT_FAILED: 'payment',
          MESSAGE_RECEIVED: 'message',
          REVIEW_RECEIVED: 'review',
          BOOKING_CONFIRMED: 'booking',
          BOOKING_CANCELLED: 'booking',
          DISPUTE_CREATED: 'dispute',
          DISPUTE_RESOLVED: 'dispute',
          PROMOTIONAL: 'promotional',
          SYSTEM_ALERT: 'system',
        };

        const type = typeMap[name] || 'general';

        // Extract variables from template using {{variable}} pattern
        const variables = [];
        const variableRegex = /\{\{(\w+)\}\}/g;
        let match;
        while ((match = variableRegex.exec(template.body || ''))) {
          if (!variables.includes(match[1])) {
            variables.push(match[1]);
          }
        }

        // Also check title for variables
        variableRegex.lastIndex = 0;
        while ((match = variableRegex.exec(template.title || ''))) {
          if (!variables.includes(match[1])) {
            variables.push(match[1]);
          }
        }

        try {
          const existing = await prisma.notificationTemplate.findFirst({
            where: {
              name,
              language,
              version: 1,
            },
          });

          if (existing) {
            console.log(`⏭️  Skipped: ${name} (${language}) - Already exists`);
            skipped++;
            continue;
          }

          await prisma.notificationTemplate.create({
            data: {
              name,
              type,
              language,
              title: template.title,
              body: template.body,
              variables: variables,
              version: 1,
              isActive: true,
            },
          });

          console.log(`✅ Created: ${name} (${language})`);
          created++;
        } catch (err) {
          if (err.code === 'P2002') {
            console.log(`⏭️  Skipped: ${name} (${language}) - Already exists`);
            skipped++;
          } else {
            throw err;
          }
        }
      }
    }

    console.log(`\n🎉 Seeding complete!`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped: ${skipped}`);
  } catch (err) {
    console.error('❌ Error seeding templates:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedNotificationTemplates();

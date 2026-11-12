/**
 * Q97: Personal Data Inventory
 * Q98: Data Classification
 * Map where PII lives, classify sensitivity, export inventory
 */

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole(['ADMIN', 'SUPER_ADMIN']));

// Static data inventory — ground truth of where PII lives in the schema
const DATA_INVENTORY = [
  {
    entity:      'User',
    table:       'users',
    fields: [
      { field: 'email',              classification: 'CONFIDENTIAL', pii: true,  gdprCategory: 'identity',  retention: 'account_lifetime' },
      { field: 'firstName',          classification: 'CONFIDENTIAL', pii: true,  gdprCategory: 'identity',  retention: 'account_lifetime' },
      { field: 'lastName',           classification: 'CONFIDENTIAL', pii: true,  gdprCategory: 'identity',  retention: 'account_lifetime' },
      { field: 'phone',              classification: 'CONFIDENTIAL', pii: true,  gdprCategory: 'contact',   retention: 'account_lifetime' },
      { field: 'avatarUrl',          classification: 'INTERNAL',     pii: true,  gdprCategory: 'biometric', retention: 'account_lifetime' },
      { field: 'city',               classification: 'INTERNAL',     pii: true,  gdprCategory: 'location',  retention: 'account_lifetime' },
      { field: 'latitude',           classification: 'RESTRICTED',   pii: true,  gdprCategory: 'location',  retention: 'account_lifetime' },
      { field: 'longitude',          classification: 'RESTRICTED',   pii: true,  gdprCategory: 'location',  retention: 'account_lifetime' },
      { field: 'passwordHash',       classification: 'RESTRICTED',   pii: false, gdprCategory: 'auth',      retention: 'account_lifetime' },
      { field: 'twoFASecret',        classification: 'RESTRICTED',   pii: false, gdprCategory: 'auth',      retention: 'account_lifetime' },
      { field: 'securityAnswerHash', classification: 'RESTRICTED',   pii: false, gdprCategory: 'auth',      retention: 'account_lifetime' },
    ],
  },
  {
    entity:      'Professional',
    table:       'professionals',
    fields: [
      { field: 'bio',         classification: 'PUBLIC',     pii: false, gdprCategory: 'professional', retention: 'account_lifetime' },
      { field: 'siret',       classification: 'CONFIDENTIAL', pii: true,  gdprCategory: 'business',   retention: '7_years_legal' },
      { field: 'idDocUrl',    classification: 'RESTRICTED',   pii: true,  gdprCategory: 'identity',   retention: '5_years' },
      { field: 'bankIban',    classification: 'RESTRICTED',   pii: true,  gdprCategory: 'financial',  retention: '7_years_legal' },
    ],
  },
  {
    entity:      'Payment',
    table:       'payments',
    fields: [
      { field: 'amount',      classification: 'CONFIDENTIAL', pii: false, gdprCategory: 'financial', retention: '7_years_legal' },
      { field: 'cardLast4',   classification: 'CONFIDENTIAL', pii: true,  gdprCategory: 'financial', retention: '7_years_legal' },
      { field: 'cardBrand',   classification: 'INTERNAL',     pii: false, gdprCategory: 'financial', retention: '7_years_legal' },
      { field: 'providerRef', classification: 'INTERNAL',     pii: false, gdprCategory: 'financial', retention: '7_years_legal' },
    ],
  },
  {
    entity:      'Message',
    table:       'messages',
    fields: [
      { field: 'content',     classification: 'CONFIDENTIAL', pii: true,  gdprCategory: 'communication', retention: '365_days' },
    ],
  },
  {
    entity:      'LoginAttempt',
    table:       'login_attempts',
    fields: [
      { field: 'ip',          classification: 'CONFIDENTIAL', pii: true,  gdprCategory: 'technical', retention: '90_days' },
      { field: 'userAgent',   classification: 'INTERNAL',     pii: true,  gdprCategory: 'technical', retention: '90_days' },
    ],
  },
  {
    entity:      'AdminLog',
    table:       'admin_logs',
    fields: [
      { field: 'ip',          classification: 'CONFIDENTIAL', pii: true,  gdprCategory: 'audit',    retention: '730_days' },
      { field: 'action',      classification: 'INTERNAL',     pii: false, gdprCategory: 'audit',    retention: '730_days' },
      { field: 'targetId',    classification: 'INTERNAL',     pii: false, gdprCategory: 'audit',    retention: '730_days' },
    ],
  },
];

// Classification levels and their descriptions
const CLASSIFICATION_LEVELS = {
  PUBLIC:       { level: 0, description: 'Freely visible, no access controls required',              color: 'green'  },
  INTERNAL:     { level: 1, description: 'Internal use only, authenticated users',                   color: 'blue'   },
  CONFIDENTIAL: { level: 2, description: 'Sensitive data, need-to-know basis, encrypted at rest',    color: 'orange' },
  RESTRICTED:   { level: 3, description: 'Highest sensitivity, encrypted, audit trail mandatory',    color: 'red'    },
};

/**
 * GET /admin/data-inventory/inventory
 * Full PII inventory across all entities
 */
router.get('/inventory', (req, res) => {
  const summary = {
    totalEntities: DATA_INVENTORY.length,
    totalFields:   DATA_INVENTORY.reduce((s, e) => s + e.fields.length, 0),
    piiFields:     DATA_INVENTORY.reduce((s, e) => s + e.fields.filter(f => f.pii).length, 0),
    byClassification: { PUBLIC: 0, INTERNAL: 0, CONFIDENTIAL: 0, RESTRICTED: 0 },
  };

  DATA_INVENTORY.forEach(e => {
    e.fields.forEach(f => {
      summary.byClassification[f.classification] = (summary.byClassification[f.classification] || 0) + 1;
    });
  });

  res.json({ success: true, data: { inventory: DATA_INVENTORY, summary } });
});

/**
 * GET /admin/data-inventory/classification
 * Data classification framework and levels
 */
router.get('/classification', (req, res) => {
  res.json({
    success: true,
    data: {
      levels: CLASSIFICATION_LEVELS,
      policies: {
        PUBLIC:       'No encryption required. Can be cached publicly.',
        INTERNAL:     'TLS in transit. Standard DB access controls.',
        CONFIDENTIAL: 'TLS in transit. Encrypted at rest. Access logged.',
        RESTRICTED:   'TLS in transit. Encrypted at rest. Access logged. MFA required. Audit trail mandatory.',
      },
      gdprCategories: [
        { category: 'identity',      legalBasis: 'contract', retentionNote: 'Until account deletion' },
        { category: 'contact',       legalBasis: 'contract', retentionNote: 'Until account deletion' },
        { category: 'location',      legalBasis: 'consent',  retentionNote: 'Until account deletion or consent withdrawal' },
        { category: 'financial',     legalBasis: 'legal',    retentionNote: '7 years (French tax law)' },
        { category: 'communication', legalBasis: 'contract', retentionNote: '365 days then anonymized' },
        { category: 'auth',          legalBasis: 'contract', retentionNote: 'Until account deletion' },
        { category: 'technical',     legalBasis: 'legitimate_interest', retentionNote: '90 days' },
        { category: 'audit',         legalBasis: 'legal',    retentionNote: '2 years' },
      ],
    },
  });
});

/**
 * GET /admin/data-inventory/pii-fields
 * All PII fields across the schema (for DPA / Data Protection Authority reports)
 */
router.get('/pii-fields', (req, res) => {
  const piiFields = [];
  DATA_INVENTORY.forEach(entity => {
    entity.fields
      .filter(f => f.pii)
      .forEach(f => {
        piiFields.push({
          entity:         entity.entity,
          table:          entity.table,
          field:          f.field,
          classification: f.classification,
          gdprCategory:   f.gdprCategory,
          retention:      f.retention,
        });
      });
  });

  res.json({
    success: true,
    data: {
      count:     piiFields.length,
      piiFields,
      exportedAt: new Date().toISOString(),
    },
  });
});

/**
 * GET /admin/data-inventory/gdpr-article-30
 * Article 30 GDPR — Record of Processing Activities (RoPA) format
 */
router.get('/gdpr-article-30', (req, res) => {
  logger.info('[DataInventory] Article 30 RoPA exported', { adminId: req.user?.id });

  res.json({
    success: true,
    data: {
      controller: {
        name:    process.env.COMPANY_NAME    || 'MANAWA SAS',
        address: process.env.COMPANY_ADDRESS || 'France',
        contact: process.env.DPO_EMAIL       || 'dpo@manawa.app',
      },
      processingActivities: [
        {
          name:          'User account management',
          purpose:       'Create and manage user accounts, authentication',
          legalBasis:    'Contract (Art. 6.1.b GDPR)',
          dataCategories: ['identity', 'contact', 'auth'],
          retention:     'Duration of account + 1 year',
          recipients:    ['Internal staff', 'Hosting provider (Render)'],
          transfers:     'No international transfers',
        },
        {
          name:          'Payment processing',
          purpose:       'Process payments between clients and professionals',
          legalBasis:    'Contract + Legal obligation (Art. 6.1.b, 6.1.c)',
          dataCategories: ['financial', 'identity'],
          retention:     '7 years (French commercial law L123-22)',
          recipients:    ['GeniusPay', 'Internal accounting'],
          transfers:     'No international transfers',
        },
        {
          name:          'Service usage analytics',
          purpose:       'Platform improvement, fraud detection',
          legalBasis:    'Legitimate interest (Art. 6.1.f)',
          dataCategories: ['technical', 'location'],
          retention:     '90–180 days',
          recipients:    ['Internal staff'],
          transfers:     'No international transfers',
        },
        {
          name:          'Support and dispute resolution',
          purpose:       'Handle support tickets and disputes',
          legalBasis:    'Contract + Legal obligation',
          dataCategories: ['identity', 'communication'],
          retention:     '1 year after resolution',
          recipients:    ['Internal staff'],
          transfers:     'No international transfers',
        },
      ],
      generatedAt: new Date().toISOString(),
    },
  });
});

module.exports = router;
module.exports.DATA_INVENTORY = DATA_INVENTORY;
module.exports.CLASSIFICATION_LEVELS = CLASSIFICATION_LEVELS;

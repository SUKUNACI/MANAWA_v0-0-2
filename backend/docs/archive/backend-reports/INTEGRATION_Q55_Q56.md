# Q55 + Q56 Integration Checklist

## Étapes d'intégration pour le backend MANAWA

### Phase 1: Setup (TERMINÉ)

- [x] Q55: Créer `/middleware/webhook-signature-verification.js`
  - Middleware de vérification HMAC-SHA256
  - Timing-safe comparison avec crypto.timingSafeEqual()
  - Reject 401 si signature invalide
  - Logging des tentatives invalides

- [x] Q56: Créer `/config/webhook-queue-config.js`
  - Configuration Bull Queue FIFO
  - Concurrency = 1 pour garantie FIFO
  - Setup error handlers

- [x] Q56: Créer `/utils/webhook-queue-manager.js`
  - Manager de la queue webhook
  - triggerWebhookQueued() remplace triggerWebhook()
  - processWebhookJob() pour traitement
  - Sequence numbers et idempotency keys

- [x] Modifier `/prisma/schema.prisma`
  - Ajouter `sequence Int` à WebhookLog
  - Ajouter `idempotencyKey String?` à WebhookLog
  - Ajouter indexes

- [x] Modifier `/config/queue.js`
  - Importer et exporter webhookQueue

- [x] Modifier `/index.js`
  - Ajouter captureRawBody middleware (AVANT JSON)
  - Initialiser webhook queue au démarrage
  - Logger status

- [x] Créer `/tests/webhooks-q55-q56.test.js`
  - Tests Q55: signature verification
  - Tests Q56: ordering guarantees
  - Tests d'intégration

- [x] Créer `/Q55_Q56_IMPLEMENTATION.md`
  - Documentation complète
  - Architecture détaillée
  - Exemples de code

### Phase 2: Migration Prisma (À FAIRE)

```bash
cd backend

# Créer la migration
npx prisma migrate dev --name "add_webhook_sequence_and_idempotency"

# OU appliquer directement en Prod:
# psql DATABASE_URL < prisma/migrations/add_webhook_q56_migration.sql
```

**Migration SQL:**
```sql
ALTER TABLE "WebhookLog" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WebhookLog" ADD COLUMN "idempotencyKey" TEXT;
CREATE INDEX "WebhookLog_sequence_idx" ON "WebhookLog"("sequence");
CREATE INDEX "WebhookLog_idempotencyKey_idx" ON "WebhookLog"("idempotencyKey");
```

### Phase 3: Mettre à jour les routes webhooks existantes (À FAIRE)

#### Paiements (GeniusPay)
File: `routes/payments.js` (ou créer route si n'existe pas)

**Avant:**
```javascript
router.post('/webhooks/geniuspay', async (req, res) => {
  // Traiter webhook
});
```

**Après:**
```javascript
const { captureRawBody, webhookSignatureVerification } = require('../middleware/webhook-signature-verification');

// Middleware
router.use(captureRawBody);
router.post('/webhooks/geniuspay', 
  webhookSignatureVerification({ 
    allowTestWebhooks: process.env.NODE_ENV === 'development'
  }), 
  async (req, res) => {
    // Vérification OK (req.webhookVerified === true)
    // Utiliser queue au lieu d'envoi direct
    
    const { triggerWebhookQueued } = require('../utils/webhook-queue-manager');
    await triggerWebhookQueued('payment.completed', {
      paymentId: req.body.id,
      status: req.body.status,
      amount: req.body.amount,
    });
    
    res.json({ received: true });
  }
);
```

#### Subscriptions (Webhook notify)
File: `routes/subscriptions.js`

```javascript
router.post('/notify',
  webhookSignatureVerification(),
  async (req, res) => {
    const { triggerWebhookQueued } = require('../utils/webhook-queue-manager');
    await triggerWebhookQueued('subscription.event', req.body);
    res.json({ received: true });
  }
);
```

### Phase 4: Setup secret de webhook (À FAIRE)

**Option 1: Variable d'environnement**
```bash
# .env
WEBHOOK_SECRET=your-secret-key-here
```

**Option 2: Depuis la BD (Webhook model)**
```javascript
// middleware/webhook-signature-verification.js
async function getWebhookSecret(webhookId) {
  const webhook = await prisma.webhook.findUnique({
    where: { id: webhookId },
    select: { secret: true },
  });
  return webhook?.secret;
}
```

**Option 3: Configuration admin**
```javascript
// routes/webhooks-admin.js - déjà implémenté
const webhook = await prisma.webhook.findUnique({
  where: { id: req.params.webhookId },
});
req.webhookSecret = webhook.secret;
```

### Phase 5: Tests et validation (À FAIRE)

```bash
# Run tests
npm test -- tests/webhooks-q55-q56.test.js

# Test Q55 signature verification
npm test -- --testNamePattern="Q55"

# Test Q56 ordering
npm test -- --testNamePattern="Q56"

# Test integration
npm test -- --testNamePattern="Integration"
```

### Phase 6: Déploiement (À FAIRE)

1. **Develop → Staging**
   ```bash
   git add .
   git commit -m "feat(Q55+Q56): Add webhook signature verification and ordering guarantees"
   git push origin feature/q55-q56-webhooks
   
   # PR review
   # Staging deploy
   ```

2. **Migrations sur Staging**
   ```bash
   # Dans Render/Staging:
   npm run migrate:dev
   ```

3. **Test e2e sur Staging**
   - Créer webhook de test
   - Envoyer payload avec signature valide → Success
   - Envoyer payload avec signature invalide → 401
   - Vérifier FIFO ordering avec 3+ webhooks
   - Vérifier idempotency key (envoyer 2x même clé)

4. **Production Migration**
   ```bash
   # Backup
   pg_dump DATABASE_URL > backup.sql
   
   # Apply migration
   psql DATABASE_URL < prisma/migrations/add_webhook_q56_migration.sql
   
   # Merge to main
   git checkout main
   git merge feature/q55-q56-webhooks
   git push origin main
   
   # Render redeploy
   # (Webhook URLs: /api/v1/payments/webhooks/geniuspay, etc.)
   ```

### Phase 7: Monitoring (À FAIRE)

**Admin Dashboard:**
- GET `/api/v1/admin/queues` - Stats webhook queue
- Webhook logs historique dans WebhookLog table

**Alertes:**
```javascript
// Check webhook queue health
const stats = await getWebhookQueueStatus();
if (stats.failed > 10) {
  // Alert!
}
if (stats.waiting > 100) {
  // Queue backing up
}
```

**Logs:**
```
[Q55] Webhook sans signature détecté
[Q55] Format de signature invalide
[Q55] Signature webhook invalide - tentative rejetée
[Q56] Webhook added to queue
[Q56] Webhook job active
[Q56] Webhook job completed
[Q56] Webhook delivery failed
```

---

## Code Changes Summary

### Files Created
1. ✓ `/middleware/webhook-signature-verification.js` - Q55 Middleware
2. ✓ `/config/webhook-queue-config.js` - Q56 Queue config
3. ✓ `/utils/webhook-queue-manager.js` - Q56 Manager
4. ✓ `/tests/webhooks-q55-q56.test.js` - Test suite
5. ✓ `/Q55_Q56_IMPLEMENTATION.md` - Full documentation
6. ✓ `/INTEGRATION_Q55_Q56.md` - This file

### Files Modified
1. ✓ `/prisma/schema.prisma` - Add sequence + idempotencyKey
2. ✓ `/config/queue.js` - Add webhookQueue export
3. ✓ `/index.js` - Add Q55/Q56 middleware + initialization

### Database Migration
- SQL: `/prisma/migrations/add_webhook_q56_migration.sql`

---

## Quick Start

### 1. Local Development
```bash
cd backend

# Setup
npm install

# Migration (local DB)
npm run migrate:dev

# Tests
npm test -- webhooks-q55-q56.test.js

# Start server
npm start
```

### 2. Test avec cURL
```bash
# Generate signature
SECRET="test-secret"
PAYLOAD='{"test":"data"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)

# Test webhook
curl -X POST http://localhost:4000/api/v1/webhooks/test \
  -H "X-Webhook-Signature: sha256=$SIGNATURE" \
  -H "X-Webhook-Event: payment.completed" \
  -H "X-Webhook-Sequence: 1" \
  -H "X-Idempotency-Key: test-key-1" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
```

### 3. Monitoring
```bash
# Queue stats
curl http://localhost:4000/api/v1/admin/queues

# Webhook logs
curl http://localhost:4000/api/v1/admin/webhooks

# Recent failures
curl http://localhost:4000/api/v1/admin/webhooks/logs?status=failed
```

---

## Status

| Component | Status | Files |
|-----------|--------|-------|
| Q55 Middleware | ✓ Complete | middleware/webhook-signature-verification.js |
| Q55 Tests | ✓ Complete | tests/webhooks-q55-q56.test.js |
| Q56 Queue Config | ✓ Complete | config/webhook-queue-config.js |
| Q56 Manager | ✓ Complete | utils/webhook-queue-manager.js |
| Q56 Tests | ✓ Complete | tests/webhooks-q55-q56.test.js |
| Prisma Schema | ✓ Complete | prisma/schema.prisma |
| Migration SQL | ✓ Complete | prisma/migrations/ |
| Documentation | ✓ Complete | Q55_Q56_IMPLEMENTATION.md |
| index.js Integration | ✓ Complete | index.js |
| config/queue.js | ✓ Complete | config/queue.js |
| Route Integration | ⏳ Pending | routes/*.js |
| Testing in Staging | ⏳ Pending | CI/CD |
| Prod Deployment | ⏳ Pending | Main branch |

---

## Next Actions

1. **Immediate:**
   - [ ] Review test suite
   - [ ] Run npm test locally
   - [ ] Verify compilation (node -c on each file)

2. **Before Merge:**
   - [ ] Migration testing
   - [ ] End-to-end webhook test
   - [ ] Performance profiling

3. **Staging:**
   - [ ] Apply migration
   - [ ] Deploy and test
   - [ ] Monitor logs

4. **Production:**
   - [ ] Backup database
   - [ ] Apply migration
   - [ ] Deploy code
   - [ ] Verify webhooks working

---

## Support

For issues:
- Q55 debugging: Check logs for `[Q55]` prefix
- Q56 debugging: Check logs for `[Q56]` prefix
- Queue status: `GET /api/v1/admin/queues`
- Full logs: `WebhookLog` table in database

Documentation: See `/Q55_Q56_IMPLEMENTATION.md`

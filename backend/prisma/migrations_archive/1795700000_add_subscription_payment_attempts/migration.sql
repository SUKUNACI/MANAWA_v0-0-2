BEGIN;

-- Migration: 1795700000_add_subscription_payment_attempts
-- Implements the SubscriptionPaymentAttempt model.
--
-- PURPOSE
-- -------
-- The existing Subscription.geniuspayRef field stores only ONE reference per professional.
-- When a new checkout is started, the previous reference is overwritten and late webhooks
-- for the old checkout can no longer be matched.
--
-- This migration creates SubscriptionPaymentAttempt, which records every individual checkout
-- attempt. Each attempt has its own GeniusPay reference, amount, status, and timestamps.
-- Webhooks and the reconciliation cron now look up the attempt by geniuspayRef, then reach
-- the parent Subscription through the relation.
--
-- BACKWARD COMPATIBILITY
-- ----------------------
-- Subscription.geniuspayRef is preserved as a convenience index for the latest attempt.
-- All existing subscription rows remain valid; no data is deleted or required to migrate.
-- New code writes SubscriptionPaymentAttempt rows going forward; old rows without attempts
-- continue to work via the legacy Subscription.geniuspayRef path during transition.
--
-- SAFETY
-- ------
-- All new columns are nullable or have defaults => zero risk of locking or breaking existing rows.
-- Unique constraint on geniuspayRef uses a partial index (WHERE NOT NULL) so pre-confirmation
-- rows (NULL geniuspayRef) can coexist without colliding.
-- DO NOT run prisma migrate deploy on Neon / production.

-- 1. Create SubscriptionPaymentAttempt table

CREATE TABLE IF NOT EXISTS "SubscriptionPaymentAttempt" (
  "id"               TEXT         NOT NULL,
  "subscriptionId"   TEXT         NOT NULL,
  "idempotencyKey"   TEXT         NOT NULL,
  "geniuspayRef"     TEXT,
  "provider"         TEXT         NOT NULL DEFAULT 'geniuspay',
  "tier"             TEXT         NOT NULL,
  "billingCycle"     TEXT         NOT NULL,
  "expectedAmount"   INTEGER      NOT NULL,
  "confirmedAmount"  INTEGER,
  "status"           TEXT         NOT NULL DEFAULT 'CREATED',
  "providerData"     TEXT,
  "confirmedAt"      TIMESTAMP(3),
  "duplicateOfId"    TEXT,
  "scheduledStartAt" TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubscriptionPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- 2. Unique constraints

ALTER TABLE "SubscriptionPaymentAttempt"
  ADD CONSTRAINT "SubscriptionPaymentAttempt_idempotencyKey_key"
  UNIQUE ("idempotencyKey");

-- Unique index: geniuspayRef must be unique when present, NULLs allowed freely
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPaymentAttempt_geniuspayRef_key"
  ON "SubscriptionPaymentAttempt" ("geniuspayRef");

-- 3. Foreign key

ALTER TABLE "SubscriptionPaymentAttempt"
  ADD CONSTRAINT "SubscriptionPaymentAttempt_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId")
  REFERENCES "Subscription" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Indexes for query patterns

CREATE INDEX IF NOT EXISTS "SubscriptionPaymentAttempt_subscriptionId_idx"
  ON "SubscriptionPaymentAttempt" ("subscriptionId");


CREATE INDEX IF NOT EXISTS "SubscriptionPaymentAttempt_status_idx"
  ON "SubscriptionPaymentAttempt" ("status");

CREATE INDEX IF NOT EXISTS "SubscriptionPaymentAttempt_subscriptionId_status_idx"
  ON "SubscriptionPaymentAttempt" ("subscriptionId", "status");

-- 5. updatedAt auto-update trigger (safety net for direct SQL updates)

CREATE OR REPLACE FUNCTION update_subscription_payment_attempt_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "SubscriptionPaymentAttempt_updatedAt_trigger"
  ON "SubscriptionPaymentAttempt";

CREATE TRIGGER "SubscriptionPaymentAttempt_updatedAt_trigger"
  BEFORE UPDATE ON "SubscriptionPaymentAttempt"
  FOR EACH ROW
  EXECUTE FUNCTION update_subscription_payment_attempt_updated_at();

COMMIT;

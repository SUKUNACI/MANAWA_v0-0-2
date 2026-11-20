-- Migration: 1795600000_add_subscription_payment_fields
-- Adds fields required for the Phase 3 subscription payment cycle.
--
-- Subscription new columns (all nullable — existing rows unaffected):
--   geniuspayRef      — reference returned by GeniusPay at checkout; used to
--                       route webhook events to the right subscription
--   billingCycle      — MONTHLY | YEARLY (default MONTHLY)
--   amount            — amount in XOF at checkout time (after promo if any)
--   lastPaymentAt     — timestamp of the last confirmed GeniusPay payment
--   gracePeriodEndsAt — 3-day window after a confirmed failure before downgrade
--
-- scheduledStartAt was already added in migration 1795169636.
-- Indexes on geniuspayRef and (status, gracePeriodEndsAt) for cron queries.

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "geniuspayRef"      TEXT,
  ADD COLUMN IF NOT EXISTS "billingCycle"      TEXT NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN IF NOT EXISTS "amount"            INTEGER,
  ADD COLUMN IF NOT EXISTS "lastPaymentAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gracePeriodEndsAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Subscription_geniuspayRef_idx"
  ON "Subscription" ("geniuspayRef")
  WHERE "geniuspayRef" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Subscription_status_grace_idx"
  ON "Subscription" ("status", "gracePeriodEndsAt");

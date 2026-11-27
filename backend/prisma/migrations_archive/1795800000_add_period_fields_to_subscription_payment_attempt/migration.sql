-- Migration: add periodStartAt / periodEndAt to SubscriptionPaymentAttempt
-- Purpose: store the billing period covered by each payment attempt so that
--          duplicate-payment detection compares periods rather than subscription
--          ACTIVE status (which breaks legitimate early-renewal detection).
--
-- DO NOT run `prisma migrate deploy` on Neon / production without a maintenance window.
-- Apply this manually after a full backup:
--   psql $DATABASE_URL -f this_file.sql

ALTER TABLE "SubscriptionPaymentAttempt"
  ADD COLUMN IF NOT EXISTS "periodStartAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "periodEndAt"   TIMESTAMP(3);

-- Partial unique index to prevent concurrent double-payments at the PostgreSQL level.
-- Two SUCCEEDED attempts on the same subscription cannot cover the same billing period.
-- Uses a partial index (WHERE status = 'SUCCEEDED' AND periodStartAt IS NOT NULL AND periodEndAt IS NOT NULL)
-- so the constraint only applies to confirmed paid periods — not to open/terminal attempts.
--
-- DO NOT run prisma migrate deploy on Neon / production without explicit authorization.
CREATE UNIQUE INDEX IF NOT EXISTS "sub_attempt_period_succeeded_unique"
  ON "SubscriptionPaymentAttempt" ("subscriptionId", "periodStartAt", "periodEndAt")
  WHERE "status" = 'SUCCEEDED'
    AND "periodStartAt" IS NOT NULL
    AND "periodEndAt"   IS NOT NULL;

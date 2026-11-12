-- Q56: Add sequence and idempotency fields to WebhookLog
-- This migration adds support for webhook ordering guarantees and idempotency

-- Add sequence column (default 0)
ALTER TABLE "WebhookLog" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

-- Add idempotencyKey column (nullable)
ALTER TABLE "WebhookLog" ADD COLUMN "idempotencyKey" TEXT;

-- Create indexes for better query performance
CREATE INDEX "WebhookLog_sequence_idx" ON "WebhookLog"("sequence");
CREATE INDEX "WebhookLog_idempotencyKey_idx" ON "WebhookLog"("idempotencyKey");

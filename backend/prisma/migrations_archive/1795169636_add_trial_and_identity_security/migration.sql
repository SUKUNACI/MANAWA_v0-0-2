-- Migration: 1795169636_add_trial_and_identity_security
-- Adds trial traceability, secure identity fields to Professional,
-- and scheduledStartAt to Subscription for deferred billing start.
--
-- Professional new columns (all nullable — existing rows unaffected):
--   trialStartedAt             — timestamp when the trial was activated
--   idDocumentHash             — HMAC-SHA256 keyed hash for document uniqueness checks
--   idDocumentNumberEncrypted  — AES-256-GCM ciphertext for authorised retrieval
--
-- Subscription new column (nullable):
--   scheduledStartAt           — when billing should actually start (used when
--                                checkout happens during an active trial: billing
--                                begins the day after the trial ends)

ALTER TABLE "Professional"
  ADD COLUMN IF NOT EXISTS "trialStartedAt"             TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "idDocumentHash"             TEXT,
  ADD COLUMN IF NOT EXISTS "idDocumentNumberEncrypted"  TEXT,
  ADD COLUMN IF NOT EXISTS "idDocumentType"             TEXT;

-- Partial unique index: only enforce uniqueness when a hash is actually set.
-- Rows without a document number (NULL) do not conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "Professional_idDocumentHash_unique"
  ON "Professional" ("idDocumentHash")
  WHERE "idDocumentHash" IS NOT NULL;

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "scheduledStartAt" TIMESTAMP(3);

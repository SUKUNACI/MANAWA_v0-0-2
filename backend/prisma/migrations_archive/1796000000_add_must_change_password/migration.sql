-- Migration: 1796000000_add_must_change_password
-- Adds mustChangePassword flag to User for the admin-initiated secure reset flow (T1.03).
--
-- When an admin triggers a password reset, the backend:
--   1. Generates a secure token, stores only its SHA-256 hash in passwordResetCode.
--   2. Sends the raw token as a one-time link to the user's email.
--   3. Sets mustChangePassword = true so the user is forced to set a new password
--      before accessing any other endpoint.
--   4. After the user confirms a new password via POST /api/auth/complete-password-reset,
--      mustChangePassword is reset to false.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "userId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "previousHash" TEXT,
    "currentHash" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable SecretAccessLog
CREATE TABLE "SecretAccessLog" (
    "id" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "secretType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "reason" TEXT,

    CONSTRAINT "SecretAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex AuditLog_currentHash_key
CREATE UNIQUE INDEX "AuditLog_currentHash_key" ON "AuditLog"("currentHash");

-- CreateIndex AuditLog_id_currentHash_key
CREATE UNIQUE INDEX "AuditLog_id_currentHash_key" ON "AuditLog"("id", "currentHash");

-- CreateIndex AuditLog_timestamp_idx
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex AuditLog_userId_idx
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex AuditLog_resourceType_idx
CREATE INDEX "AuditLog_resourceType_idx" ON "AuditLog"("resourceType");

-- CreateIndex AuditLog_resourceId_idx
CREATE INDEX "AuditLog_resourceId_idx" ON "AuditLog"("resourceId");

-- CreateIndex SecretAccessLog_timestamp_idx
CREATE INDEX "SecretAccessLog_timestamp_idx" ON "SecretAccessLog"("timestamp");

-- CreateIndex SecretAccessLog_userId_idx
CREATE INDEX "SecretAccessLog_userId_idx" ON "SecretAccessLog"("userId");

-- CreateIndex SecretAccessLog_secretType_idx
CREATE INDEX "SecretAccessLog_secretType_idx" ON "SecretAccessLog"("secretType");

-- ============================================================================
-- SECTION 2: IMMUTABILITY PROTECTIONS (TRIGGERS & CONSTRAINTS)
-- ============================================================================

-- 1. AUDITLOG: Prevent UPDATE and DELETE (append-only semantics)
-- ────────────────────────────────────────────────────────────

CREATE FUNCTION prevent_auditlog_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is immutable: INSERT-only. UPDATE/DELETE forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditlog_prevent_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_auditlog_mutation();

CREATE TRIGGER auditlog_prevent_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_auditlog_mutation();

-- 2. SECRETACCESSLOG: Prevent UPDATE and DELETE
-- ──────────────────────────────────────────────

CREATE FUNCTION prevent_secretaccesslog_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'SecretAccessLog is immutable: INSERT-only. UPDATE/DELETE forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER secretaccesslog_prevent_update
  BEFORE UPDATE ON "SecretAccessLog"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_secretaccesslog_mutation();

CREATE TRIGGER secretaccesslog_prevent_delete
  BEFORE DELETE ON "SecretAccessLog"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_secretaccesslog_mutation();

-- 3. SECRETACCESSLOG: Enforce NOT NULL constraints for Prisma alignment
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE "SecretAccessLog"
  ADD CONSTRAINT check_secretaccesslog_userid_not_null
  CHECK ("userId" IS NOT NULL);

ALTER TABLE "SecretAccessLog"
  ADD CONSTRAINT check_secretaccesslog_ipaddress_not_null
  CHECK ("ipAddress" IS NOT NULL);

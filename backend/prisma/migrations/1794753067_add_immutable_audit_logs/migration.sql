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

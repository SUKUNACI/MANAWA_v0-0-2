-- CreateTable SecretRotationSchedule
CREATE TABLE "SecretRotationSchedule" (
    "id" TEXT NOT NULL,
    "secretName" TEXT NOT NULL,
    "secretType" TEXT NOT NULL,
    "rotationInterval" INTEGER NOT NULL,
    "lastRotated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextRotation" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rotationMethod" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "SecretRotationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex SecretRotationSchedule_secretName_key
CREATE UNIQUE INDEX "SecretRotationSchedule_secretName_key" ON "SecretRotationSchedule"("secretName");

-- CreateIndex SecretRotationSchedule_nextRotation_idx
CREATE INDEX "SecretRotationSchedule_nextRotation_idx" ON "SecretRotationSchedule"("nextRotation");

-- CreateIndex SecretRotationSchedule_enabled_idx
CREATE INDEX "SecretRotationSchedule_enabled_idx" ON "SecretRotationSchedule"("enabled");

-- CreateTable SecretRotationLog
CREATE TABLE "SecretRotationLog" (
    "id" TEXT NOT NULL,
    "secretName" TEXT NOT NULL,
    "rotationType" TEXT NOT NULL,
    "oldHash" TEXT NOT NULL,
    "newHash" TEXT NOT NULL,
    "rotatedBy" TEXT,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "SecretRotationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex SecretRotationLog_secretName_idx
CREATE INDEX "SecretRotationLog_secretName_idx" ON "SecretRotationLog"("secretName");

-- CreateIndex SecretRotationLog_rotatedAt_idx
CREATE INDEX "SecretRotationLog_rotatedAt_idx" ON "SecretRotationLog"("rotatedAt");

-- CreateIndex SecretRotationLog_status_idx
CREATE INDEX "SecretRotationLog_status_idx" ON "SecretRotationLog"("status");

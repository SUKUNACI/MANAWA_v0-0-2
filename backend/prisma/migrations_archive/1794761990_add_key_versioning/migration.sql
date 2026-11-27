-- CreateTable KeyVersion
CREATE TABLE "KeyVersion" (
    "id" TEXT NOT NULL,
    "keyName" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "algorithm" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "KeyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex KeyVersion_keyName_version_key
CREATE UNIQUE INDEX "KeyVersion_keyName_version_key" ON "KeyVersion"("keyName", "version");

-- CreateIndex KeyVersion_keyName_idx
CREATE INDEX "KeyVersion_keyName_idx" ON "KeyVersion"("keyName");

-- CreateIndex KeyVersion_isActive_idx
CREATE INDEX "KeyVersion_isActive_idx" ON "KeyVersion"("isActive");

-- CreateIndex KeyVersion_createdAt_idx
CREATE INDEX "KeyVersion_createdAt_idx" ON "KeyVersion"("createdAt");

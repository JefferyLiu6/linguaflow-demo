-- CreateTable
CREATE TABLE "DrillSession" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "clientSessionId" TEXT NOT NULL,
    "date" DOUBLE PRECISION NOT NULL,
    "drillType" TEXT NOT NULL,
    "language" TEXT,
    "correct" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "accuracy" INTEGER NOT NULL,
    "avgTime" DOUBLE PRECISION NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrillSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomList" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "items" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" UUID NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'es',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "DrillSession_userId_idx" ON "DrillSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DrillSession_userId_clientSessionId_key" ON "DrillSession"("userId", "clientSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomList_userId_key" ON "CustomList"("userId");

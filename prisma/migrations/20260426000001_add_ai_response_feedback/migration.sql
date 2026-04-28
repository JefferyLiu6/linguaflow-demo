CREATE TABLE "AiResponseFeedback" (
    "id"               TEXT NOT NULL,
    "userId"           UUID NOT NULL,
    "responseId"       TEXT NOT NULL,
    "surface"          TEXT NOT NULL,
    "mode"             TEXT NOT NULL,
    "language"         TEXT NOT NULL,
    "itemId"           TEXT NOT NULL,
    "sourceId"         TEXT NOT NULL,
    "sourceTitle"      TEXT NOT NULL,
    "helpful"          BOOLEAN NOT NULL,
    "userPrompt"       TEXT,
    "assistantMessage" TEXT NOT NULL,
    "model"            TEXT NOT NULL,
    "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiResponseFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiResponseFeedback_userId_responseId_key"
    ON "AiResponseFeedback"("userId", "responseId");

CREATE INDEX "AiResponseFeedback_userId_createdAt_idx"
    ON "AiResponseFeedback"("userId", "createdAt");

CREATE INDEX "AiResponseFeedback_surface_createdAt_idx"
    ON "AiResponseFeedback"("surface", "createdAt");

CREATE INDEX "AiResponseFeedback_sourceId_createdAt_idx"
    ON "AiResponseFeedback"("sourceId", "createdAt");

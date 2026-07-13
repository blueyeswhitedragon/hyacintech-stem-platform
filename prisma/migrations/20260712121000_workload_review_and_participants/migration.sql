-- CreateTable
CREATE TABLE "CampaignParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskLimit" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignParticipant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AnnotationCampaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnnotationWorkReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL DEFAULT '',
    "reviewerId" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AnnotationWorkReview_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AnnotationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnnotationWorkReview_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "AnnotationRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnnotationWorkReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Existing submitted work must be checked explicitly; do not silently count it as approved.
INSERT INTO "AnnotationWorkReview" (
    "id", "taskId", "revisionId", "status", "note", "createdAt", "updatedAt"
)
SELECT
    lower(hex(randomblob(16))),
    revision."taskId",
    revision."id",
    CASE WHEN task."status" = 'RETURNED' THEN 'RETURNED' ELSE 'PENDING' END,
    '由历史提交记录自动回填',
    revision."createdAt",
    CURRENT_TIMESTAMP
FROM "AnnotationRevision" AS revision
JOIN "AnnotationTask" AS task ON task."id" = revision."taskId"
WHERE task."status" IN ('SUBMITTED', 'RETURNED')
  AND revision."version" = (
      SELECT MAX(latest."version")
      FROM "AnnotationRevision" AS latest
      WHERE latest."taskId" = revision."taskId"
  );

-- CreateIndex
CREATE UNIQUE INDEX "CampaignParticipant_campaignId_userId_key" ON "CampaignParticipant"("campaignId", "userId");

-- CreateIndex
CREATE INDEX "CampaignParticipant_userId_active_idx" ON "CampaignParticipant"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationWorkReview_revisionId_key" ON "AnnotationWorkReview"("revisionId");

-- CreateIndex
CREATE INDEX "AnnotationWorkReview_status_createdAt_idx" ON "AnnotationWorkReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AnnotationWorkReview_taskId_status_idx" ON "AnnotationWorkReview"("taskId", "status");

-- CreateIndex
CREATE INDEX "AnnotationWorkReview_reviewerId_idx" ON "AnnotationWorkReview"("reviewerId");

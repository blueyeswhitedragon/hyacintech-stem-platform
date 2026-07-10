-- CreateTable
CREATE TABLE "DatasetBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IMPORTED',
    "manifestJson" TEXT NOT NULL DEFAULT '{}',
    "summaryJson" TEXT NOT NULL DEFAULT '{}',
    "importedById" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatasetBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DatasetSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "familyKey" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "scenario" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "candidateTier" TEXT NOT NULL,
    "rubricTargetsJson" TEXT NOT NULL DEFAULT '[]',
    "autoCheckJson" TEXT NOT NULL DEFAULT '{}',
    "originalRecordJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatasetSample_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DatasetBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnnotationCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "selectionJson" TEXT NOT NULL DEFAULT '{}',
    "protocol" TEXT NOT NULL DEFAULT 'GOLD_DOUBLE_SILVER_SINGLE',
    "styleQuotaJson" TEXT NOT NULL DEFAULT '{}',
    "goldSlots" INTEGER NOT NULL DEFAULT 2,
    "silverDoubleReviewPercent" INTEGER NOT NULL DEFAULT 30,
    "maxActivePerAnnotator" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "AnnotationCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnnotationTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "styleFamily" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "draftJson" TEXT NOT NULL DEFAULT '{}',
    "leaseExpiresAt" DATETIME,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AnnotationTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AnnotationCampaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnnotationTask_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "DatasetSample" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnnotationTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnnotationRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentJson" TEXT NOT NULL,
    "fullRecordJson" TEXT NOT NULL,
    "issueTagsJson" TEXT NOT NULL DEFAULT '[]',
    "changeReason" TEXT NOT NULL DEFAULT '',
    "noChange" BOOLEAN NOT NULL DEFAULT false,
    "parentRevisionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnotationRevision_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AnnotationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnnotationRevision_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "DatasetSample" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnnotationRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AnnotationRevision_parentRevisionId_fkey" FOREIGN KEY ("parentRevisionId") REFERENCES "AnnotationRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "candidateRevisionIdsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedReviewerId" TEXT,
    "assignedAt" DATETIME,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewCase_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AnnotationCampaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewCase_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "DatasetSample" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewCase_assignedReviewerId_fkey" FOREIGN KEY ("assignedReviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reviewCaseId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "selectedRevisionId" TEXT,
    "mergedRevisionId" TEXT,
    "finalTier" TEXT NOT NULL,
    "rubricJson" TEXT NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewDecision_reviewCaseId_fkey" FOREIGN KEY ("reviewCaseId") REFERENCES "ReviewCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewDecision_selectedRevisionId_fkey" FOREIGN KEY ("selectedRevisionId") REFERENCES "AnnotationRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReviewDecision_mergedRevisionId_fkey" FOREIGN KEY ("mergedRevisionId") REFERENCES "AnnotationRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DatasetRelease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "campaignId" TEXT,
    "recipeJson" TEXT NOT NULL DEFAULT '{}',
    "summaryJson" TEXT NOT NULL DEFAULT '{}',
    "cleanPath" TEXT,
    "cleanSha256" TEXT,
    "goldPath" TEXT,
    "goldSha256" TEXT,
    "silverPath" TEXT,
    "silverSha256" TEXT,
    "manifestPath" TEXT,
    "manifestSha256" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenAt" DATETIME,
    CONSTRAINT "DatasetRelease_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AnnotationCampaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DatasetRelease_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DatasetReleaseItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "releaseId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "revisionId" TEXT,
    "tier" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1,
    "inclusionReason" TEXT NOT NULL,
    "recordJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatasetReleaseItem_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "DatasetRelease" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DatasetReleaseItem_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "DatasetSample" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DatasetReleaseItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "AnnotationRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "baseModel" TEXT NOT NULL,
    "externalTaskId" TEXT,
    "parametersJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "modelTag" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingRun_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "DatasetRelease" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TrainingRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IMPORTED',
    "modelATag" TEXT NOT NULL,
    "modelBTag" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "summaryJson" TEXT NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvaluationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvaluationArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "jsonData" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvaluationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataLabAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataLabAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DatasetBatch_name_key" ON "DatasetBatch"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetBatch_sourceSha256_key" ON "DatasetBatch"("sourceSha256");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetSample_sourceRecordId_key" ON "DatasetSample"("sourceRecordId");

-- CreateIndex
CREATE INDEX "DatasetSample_phase_idx" ON "DatasetSample"("phase");

-- CreateIndex
CREATE INDEX "DatasetSample_candidateTier_idx" ON "DatasetSample"("candidateTier");

-- CreateIndex
CREATE INDEX "DatasetSample_familyKey_idx" ON "DatasetSample"("familyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationCampaign_name_key" ON "AnnotationCampaign"("name");

-- CreateIndex
CREATE INDEX "AnnotationTask_campaignId_status_idx" ON "AnnotationTask"("campaignId", "status");

-- CreateIndex
CREATE INDEX "AnnotationTask_assignedToId_status_idx" ON "AnnotationTask"("assignedToId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationTask_campaignId_sampleId_slot_key" ON "AnnotationTask"("campaignId", "sampleId", "slot");

-- CreateIndex
CREATE INDEX "AnnotationRevision_sampleId_idx" ON "AnnotationRevision"("sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationRevision_taskId_version_key" ON "AnnotationRevision"("taskId", "version");

-- CreateIndex
CREATE INDEX "ReviewCase_status_idx" ON "ReviewCase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewCase_campaignId_sampleId_key" ON "ReviewCase"("campaignId", "sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDecision_reviewCaseId_key" ON "ReviewDecision"("reviewCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetRelease_version_key" ON "DatasetRelease"("version");

-- CreateIndex
CREATE INDEX "DatasetReleaseItem_tier_idx" ON "DatasetReleaseItem"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "DatasetReleaseItem_releaseId_sampleId_key" ON "DatasetReleaseItem"("releaseId", "sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingRun_name_key" ON "TrainingRun"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRun_name_key" ON "EvaluationRun"("name");

-- CreateIndex
CREATE INDEX "EvaluationArtifact_sha256_idx" ON "EvaluationArtifact"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationArtifact_runId_kind_tag_key" ON "EvaluationArtifact"("runId", "kind", "tag");

-- CreateIndex
CREATE INDEX "DataLabAuditLog_entityType_entityId_idx" ON "DataLabAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "DataLabAuditLog_createdAt_idx" ON "DataLabAuditLog"("createdAt");

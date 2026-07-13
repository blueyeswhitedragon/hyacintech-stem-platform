ALTER TABLE "Assignment" ADD COLUMN "dataContributionMode" TEXT NOT NULL DEFAULT 'DISABLED';
ALTER TABLE "Assignment" ADD COLUMN "dataPolicyVersion" TEXT;
ALTER TABLE "StudentAssignment" ADD COLUMN "dataConsentStatus" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE';
ALTER TABLE "StudentAssignment" ADD COLUMN "dataConsentPolicyVersion" TEXT;
ALTER TABLE "StudentAssignment" ADD COLUMN "dataConsentDecidedAt" DATETIME;

CREATE TABLE "ProductionCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationTraceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOMINATED',
    "triggerType" TEXT NOT NULL,
    "triggerNote" TEXT NOT NULL DEFAULT '',
    "signalJson" TEXT NOT NULL DEFAULT '{}',
    "consentStatusSnapshot" TEXT NOT NULL,
    "dataPolicyVersion" TEXT NOT NULL,
    "redactedRecordJson" TEXT NOT NULL,
    "redactionReportJson" TEXT NOT NULL DEFAULT '{}',
    "contentSha256" TEXT NOT NULL,
    "familyKey" TEXT NOT NULL,
    "leakageCheckJson" TEXT NOT NULL DEFAULT '{}',
    "nominatedById" TEXT,
    "processedById" TEXT,
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "convertedSampleId" TEXT,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductionCandidate_generationTraceId_fkey" FOREIGN KEY ("generationTraceId") REFERENCES "GenerationTrace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionCandidate_nominatedById_fkey" FOREIGN KEY ("nominatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductionCandidate_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductionCandidate_convertedSampleId_fkey" FOREIGN KEY ("convertedSampleId") REFERENCES "DatasetSample" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProductionCandidate_generationTraceId_key" ON "ProductionCandidate"("generationTraceId");
CREATE UNIQUE INDEX "ProductionCandidate_convertedSampleId_key" ON "ProductionCandidate"("convertedSampleId");
CREATE INDEX "ProductionCandidate_status_createdAt_idx" ON "ProductionCandidate"("status", "createdAt");
CREATE INDEX "ProductionCandidate_contentSha256_idx" ON "ProductionCandidate"("contentSha256");
CREATE INDEX "ProductionCandidate_familyKey_idx" ON "ProductionCandidate"("familyKey");

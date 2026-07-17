-- CreateTable
CREATE TABLE "TopicCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayTitle" TEXT NOT NULL,
    "studentOpening" TEXT NOT NULL,
    "internalArchetype" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "gradeBand" TEXT NOT NULL,
    "coreMechanism" TEXT NOT NULL,
    "acceptableDirectionsJson" TEXT NOT NULL DEFAULT '[]',
    "forbiddenDirectionsJson" TEXT NOT NULL DEFAULT '[]',
    "curriculumAnchorsJson" TEXT NOT NULL DEFAULT '[]',
    "sourceJson" TEXT NOT NULL DEFAULT '{}',
    "compilerEvidenceJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TopicCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TopicCard_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BootstrapGenerationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "modelConfigJson" TEXT NOT NULL DEFAULT '{}',
    "promptHashesJson" TEXT NOT NULL DEFAULT '{}',
    "parametersJson" TEXT NOT NULL DEFAULT '{}',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT NOT NULL DEFAULT '',
    "parentRunId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "BootstrapGenerationRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "BootstrapGenerationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BootstrapGenerationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TutorTurnCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicCardId" TEXT,
    "generationRunId" TEXT,
    "phase" INTEGER NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'USER_MESSAGE',
    "studentMessage" TEXT NOT NULL DEFAULT '',
    "historyJson" TEXT NOT NULL DEFAULT '[]',
    "stageStateJson" TEXT NOT NULL DEFAULT '{}',
    "visibleFactsJson" TEXT NOT NULL DEFAULT '{}',
    "privateReviewSpecJson" TEXT NOT NULL DEFAULT '{}',
    "dataSource" TEXT NOT NULL DEFAULT 'BOOTSTRAP',
    "split" TEXT NOT NULL DEFAULT 'TRAIN',
    "contractVersion" TEXT NOT NULL DEFAULT 'tutor-language-v1',
    "extractorVersion" TEXT NOT NULL DEFAULT 'student-fact-extractor-v1',
    "promptVersion" TEXT NOT NULL DEFAULT 'tutor-language-prompt-v1',
    "systemPrompt" TEXT NOT NULL,
    "promptSha256" TEXT NOT NULL,
    "hardCheckJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'READY',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TutorTurnCase_topicCardId_fkey" FOREIGN KEY ("topicCardId") REFERENCES "TopicCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TutorTurnCase_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "BootstrapGenerationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TutorCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "generationRunId" TEXT,
    "slot" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "modelFamily" TEXT NOT NULL,
    "externalModelId" TEXT NOT NULL,
    "modelVersionTag" TEXT NOT NULL,
    "rawOutput" TEXT NOT NULL,
    "normalizedOutput" TEXT NOT NULL,
    "deterministicCheckJson" TEXT NOT NULL DEFAULT '{}',
    "critiqueJson" TEXT NOT NULL DEFAULT '{}',
    "generationParamsJson" TEXT NOT NULL DEFAULT '{}',
    "promptSha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TutorCandidate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TutorTurnCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TutorCandidate_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "BootstrapGenerationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TutorReviewTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "leaseExpiresAt" DATETIME,
    "operatorId" TEXT,
    "decision" TEXT NOT NULL DEFAULT '',
    "selectedCandidateId" TEXT,
    "preferenceRejectedCandidateId" TEXT,
    "draftJson" TEXT NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL DEFAULT '',
    "preferenceReason" TEXT NOT NULL DEFAULT '',
    "warningClosureJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "submittedAt" DATETIME,
    CONSTRAINT "TutorReviewTask_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TutorTurnCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TutorReviewTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TutorReviewTask_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TutorReviewTask_selectedCandidateId_fkey" FOREIGN KEY ("selectedCandidateId") REFERENCES "TutorCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TutorReviewTask_preferenceRejectedCandidateId_fkey" FOREIGN KEY ("preferenceRejectedCandidateId") REFERENCES "TutorCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinalizedTutorTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "finalOutputJson" TEXT NOT NULL,
    "selectedCandidateId" TEXT,
    "preferenceRejectedCandidateId" TEXT,
    "editMetricsJson" TEXT NOT NULL DEFAULT '{}',
    "firstReviewerId" TEXT NOT NULL,
    "secondReviewerId" TEXT NOT NULL,
    "warningClosureJson" TEXT NOT NULL DEFAULT '{}',
    "preferenceReason" TEXT NOT NULL DEFAULT '',
    "trainingEligibility" TEXT NOT NULL DEFAULT 'BLOCKED',
    "eligibilityReasonJson" TEXT NOT NULL DEFAULT '[]',
    "contentSha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinalizedTutorTurn_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TutorTurnCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FinalizedTutorTurn_selectedCandidateId_fkey" FOREIGN KEY ("selectedCandidateId") REFERENCES "TutorCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FinalizedTutorTurn_preferenceRejectedCandidateId_fkey" FOREIGN KEY ("preferenceRejectedCandidateId") REFERENCES "TutorCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FinalizedTutorTurn_firstReviewerId_fkey" FOREIGN KEY ("firstReviewerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FinalizedTutorTurn_secondReviewerId_fkey" FOREIGN KEY ("secondReviewerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StateExtractionTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "userMessageId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "providerSnapshot" TEXT NOT NULL,
    "externalModelSnapshot" TEXT NOT NULL,
    "modelFamily" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptSha256" TEXT NOT NULL,
    "sourceMessagesJson" TEXT NOT NULL,
    "rawOutput" TEXT NOT NULL,
    "validatedFactsJson" TEXT NOT NULL DEFAULT '[]',
    "rejectedFactsJson" TEXT NOT NULL DEFAULT '[]',
    "generationParamsJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
    "failureReason" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StateExtractionTrace_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "messages" TEXT NOT NULL DEFAULT '[]',
    "stageData" TEXT NOT NULL DEFAULT '{}',
    "safetyQuizCompleted" BOOLEAN NOT NULL DEFAULT false,
    "resolvedStyleFamily" TEXT NOT NULL DEFAULT 'classroom_coach',
    "stylePolicyVersion" TEXT NOT NULL DEFAULT 'style-v1',
    "traceCoverage" TEXT NOT NULL DEFAULT 'LEGACY_UNVERIFIED',
    "deployedModelVersionId" TEXT,
    "contractVersion" TEXT NOT NULL DEFAULT 'stage-contract-v2',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_deployedModelVersionId_fkey" FOREIGN KEY ("deployedModelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Conversation" ("createdAt", "deployedModelVersionId", "id", "messages", "resolvedStyleFamily", "safetyQuizCompleted", "stageData", "stylePolicyVersion", "traceCoverage", "updatedAt", "userId") SELECT "createdAt", "deployedModelVersionId", "id", "messages", "resolvedStyleFamily", "safetyQuizCompleted", "stageData", "stylePolicyVersion", "traceCoverage", "updatedAt", "userId" FROM "Conversation";
DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
-- Existing conversations remain on the historical contract and are pinned before new sessions start using tutor-language-v1.
UPDATE "Conversation"
SET "deployedModelVersionId" = (
  SELECT "modelVersionId" FROM "ModelDeployment"
  WHERE "environment" = 'PRODUCTION' AND "status" = 'ACTIVE'
  ORDER BY "startedAt" DESC LIMIT 1
)
WHERE "deployedModelVersionId" IS NULL;
CREATE TABLE "new_DatasetReleaseItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "releaseId" TEXT NOT NULL,
    "sampleId" TEXT,
    "finalizedTutorTurnId" TEXT,
    "revisionId" TEXT,
    "tier" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1,
    "inclusionReason" TEXT NOT NULL,
    "recordJson" TEXT NOT NULL,
    "styleFamily" TEXT,
    "stylePolicyVersion" TEXT,
    "trainingEligibility" TEXT NOT NULL DEFAULT 'SFT_ALLOWED',
    "eligibilityReasonJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatasetReleaseItem_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "DatasetRelease" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DatasetReleaseItem_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "DatasetSample" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DatasetReleaseItem_finalizedTutorTurnId_fkey" FOREIGN KEY ("finalizedTutorTurnId") REFERENCES "FinalizedTutorTurn" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DatasetReleaseItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "AnnotationRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DatasetReleaseItem" ("createdAt", "eligibilityReasonJson", "id", "inclusionReason", "recordJson", "releaseId", "revisionId", "sampleId", "styleFamily", "stylePolicyVersion", "tier", "trainingEligibility", "weight") SELECT "createdAt", "eligibilityReasonJson", "id", "inclusionReason", "recordJson", "releaseId", "revisionId", "sampleId", "styleFamily", "stylePolicyVersion", "tier", "trainingEligibility", "weight" FROM "DatasetReleaseItem";
DROP TABLE "DatasetReleaseItem";
ALTER TABLE "new_DatasetReleaseItem" RENAME TO "DatasetReleaseItem";
CREATE INDEX "DatasetReleaseItem_tier_idx" ON "DatasetReleaseItem"("tier");
CREATE UNIQUE INDEX "DatasetReleaseItem_releaseId_sampleId_key" ON "DatasetReleaseItem"("releaseId", "sampleId");
CREATE UNIQUE INDEX "DatasetReleaseItem_releaseId_finalizedTutorTurnId_key" ON "DatasetReleaseItem"("releaseId", "finalizedTutorTurnId");
CREATE TABLE "new_EvaluationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IMPORTED',
    "modelATag" TEXT NOT NULL,
    "modelBTag" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "summaryJson" TEXT NOT NULL DEFAULT '{}',
    "styleFamily" TEXT,
    "stylePolicyVersion" TEXT,
    "modelAVersionId" TEXT,
    "modelBVersionId" TEXT,
    "gateResult" TEXT NOT NULL DEFAULT 'NOT_EVALUATED',
    "gateReportJson" TEXT NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvaluationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EvaluationRun_modelAVersionId_fkey" FOREIGN KEY ("modelAVersionId") REFERENCES "ModelVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EvaluationRun_modelBVersionId_fkey" FOREIGN KEY ("modelBVersionId") REFERENCES "ModelVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_EvaluationRun" ("createdAt", "createdById", "gateReportJson", "gateResult", "id", "modelATag", "modelAVersionId", "modelBTag", "modelBVersionId", "name", "scope", "status", "styleFamily", "stylePolicyVersion", "summaryJson", "updatedAt") SELECT "createdAt", "createdById", "gateReportJson", "gateResult", "id", "modelATag", "modelAVersionId", "modelBTag", "modelBVersionId", "name", "scope", "status", "styleFamily", "stylePolicyVersion", "summaryJson", "updatedAt" FROM "EvaluationRun";
DROP TABLE "EvaluationRun";
ALTER TABLE "new_EvaluationRun" RENAME TO "EvaluationRun";
CREATE UNIQUE INDEX "EvaluationRun_name_key" ON "EvaluationRun"("name");
CREATE TABLE "new_ModelDeployment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelVersionId" TEXT NOT NULL,
    "previousModelVersionId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "rolloutPercent" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "evaluationRunId" TEXT,
    "createdById" TEXT,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "gateReportJson" TEXT NOT NULL DEFAULT '{}',
    "observationJson" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "ModelDeployment_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModelDeployment_previousModelVersionId_fkey" FOREIGN KEY ("previousModelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelDeployment_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "EvaluationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelDeployment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ModelDeployment" ("createdAt", "createdById", "endedAt", "environment", "evaluationRunId", "gateReportJson", "id", "modelVersionId", "previousModelVersionId", "rolloutPercent", "startedAt", "status", "updatedAt") SELECT "createdAt", "createdById", "endedAt", "environment", "evaluationRunId", "gateReportJson", "id", "modelVersionId", "previousModelVersionId", "rolloutPercent", "startedAt", "status", "updatedAt" FROM "ModelDeployment";
DROP TABLE "ModelDeployment";
ALTER TABLE "new_ModelDeployment" RENAME TO "ModelDeployment";
CREATE INDEX "ModelDeployment_environment_status_idx" ON "ModelDeployment"("environment", "status");
CREATE INDEX "ModelDeployment_modelVersionId_idx" ON "ModelDeployment"("modelVersionId");
CREATE TABLE "new_ModelVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tag" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalModelId" TEXT NOT NULL,
    "parentModelVersionId" TEXT,
    "trainingRunId" TEXT,
    "promptPolicyVersion" TEXT NOT NULL DEFAULT 'stem-six-phase-v2',
    "contractVersion" TEXT NOT NULL DEFAULT 'stage-contract-v2',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModelVersion_parentModelVersionId_fkey" FOREIGN KEY ("parentModelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelVersion_trainingRunId_fkey" FOREIGN KEY ("trainingRunId") REFERENCES "TrainingRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ModelVersion" ("contractVersion", "createdAt", "createdById", "externalModelId", "id", "parentModelVersionId", "promptPolicyVersion", "provider", "status", "tag", "trainingRunId", "updatedAt") SELECT "contractVersion", "createdAt", "createdById", "externalModelId", "id", "parentModelVersionId", "promptPolicyVersion", "provider", "status", "tag", "trainingRunId", "updatedAt" FROM "ModelVersion";
DROP TABLE "ModelVersion";
ALTER TABLE "new_ModelVersion" RENAME TO "ModelVersion";
CREATE UNIQUE INDEX "ModelVersion_tag_key" ON "ModelVersion"("tag");
CREATE UNIQUE INDEX "ModelVersion_trainingRunId_key" ON "ModelVersion"("trainingRunId");
CREATE INDEX "ModelVersion_provider_externalModelId_idx" ON "ModelVersion"("provider", "externalModelId");
CREATE INDEX "ModelVersion_parentModelVersionId_idx" ON "ModelVersion"("parentModelVersionId");
CREATE INDEX "ModelVersion_status_idx" ON "ModelVersion"("status");
CREATE TABLE "new_ProductionCandidate" (
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
    "convertedTutorTurnCaseId" TEXT,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductionCandidate_generationTraceId_fkey" FOREIGN KEY ("generationTraceId") REFERENCES "GenerationTrace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductionCandidate_nominatedById_fkey" FOREIGN KEY ("nominatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductionCandidate_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductionCandidate_convertedSampleId_fkey" FOREIGN KEY ("convertedSampleId") REFERENCES "DatasetSample" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductionCandidate_convertedTutorTurnCaseId_fkey" FOREIGN KEY ("convertedTutorTurnCaseId") REFERENCES "TutorTurnCase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ProductionCandidate" ("consentStatusSnapshot", "contentSha256", "convertedSampleId", "createdAt", "dataPolicyVersion", "familyKey", "generationTraceId", "id", "leakageCheckJson", "nominatedById", "processedAt", "processedById", "redactedRecordJson", "redactionReportJson", "rejectionReason", "signalJson", "status", "triggerNote", "triggerType", "updatedAt") SELECT "consentStatusSnapshot", "contentSha256", "convertedSampleId", "createdAt", "dataPolicyVersion", "familyKey", "generationTraceId", "id", "leakageCheckJson", "nominatedById", "processedAt", "processedById", "redactedRecordJson", "redactionReportJson", "rejectionReason", "signalJson", "status", "triggerNote", "triggerType", "updatedAt" FROM "ProductionCandidate";
DROP TABLE "ProductionCandidate";
ALTER TABLE "new_ProductionCandidate" RENAME TO "ProductionCandidate";
CREATE UNIQUE INDEX "ProductionCandidate_generationTraceId_key" ON "ProductionCandidate"("generationTraceId");
CREATE UNIQUE INDEX "ProductionCandidate_convertedSampleId_key" ON "ProductionCandidate"("convertedSampleId");
CREATE UNIQUE INDEX "ProductionCandidate_convertedTutorTurnCaseId_key" ON "ProductionCandidate"("convertedTutorTurnCaseId");
CREATE INDEX "ProductionCandidate_status_createdAt_idx" ON "ProductionCandidate"("status", "createdAt");
CREATE INDEX "ProductionCandidate_contentSha256_idx" ON "ProductionCandidate"("contentSha256");
CREATE INDEX "ProductionCandidate_familyKey_idx" ON "ProductionCandidate"("familyKey");
CREATE TABLE "new_TrainingRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "baseModel" TEXT NOT NULL,
    "externalTaskId" TEXT,
    "parametersJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "modelTag" TEXT,
    "parentModelVersionId" TEXT,
    "eligibilityReportJson" TEXT NOT NULL DEFAULT '{}',
    "policyVersion" TEXT NOT NULL DEFAULT 'training-policy-v1',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingRun_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "DatasetRelease" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TrainingRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TrainingRun_parentModelVersionId_fkey" FOREIGN KEY ("parentModelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TrainingRun" ("baseModel", "createdAt", "createdById", "eligibilityReportJson", "externalTaskId", "id", "modelTag", "name", "notes", "parametersJson", "parentModelVersionId", "policyVersion", "releaseId", "status", "updatedAt") SELECT "baseModel", "createdAt", "createdById", "eligibilityReportJson", "externalTaskId", "id", "modelTag", "name", "notes", "parametersJson", "parentModelVersionId", "policyVersion", "releaseId", "status", "updatedAt" FROM "TrainingRun";
DROP TABLE "TrainingRun";
ALTER TABLE "new_TrainingRun" RENAME TO "TrainingRun";
CREATE UNIQUE INDEX "TrainingRun_name_key" ON "TrainingRun"("name");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" DATETIME,
    "disabledReason" TEXT NOT NULL DEFAULT '',
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "disabledAt", "disabledReason", "displayName", "id", "isActive", "lastLoginAt", "passwordHash", "role", "sessionVersion", "updatedAt", "username") SELECT "createdAt", "disabledAt", "disabledReason", "displayName", "id", "isActive", "lastLoginAt", "passwordHash", "role", "sessionVersion", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TopicCard_status_subject_idx" ON "TopicCard"("status", "subject");

-- CreateIndex
CREATE INDEX "TopicCard_approvedAt_idx" ON "TopicCard"("approvedAt");

-- CreateIndex
CREATE INDEX "BootstrapGenerationRun_kind_status_createdAt_idx" ON "BootstrapGenerationRun"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TutorTurnCase_status_split_phase_idx" ON "TutorTurnCase"("status", "split", "phase");

-- CreateIndex
CREATE INDEX "TutorTurnCase_topicCardId_phase_idx" ON "TutorTurnCase"("topicCardId", "phase");

-- CreateIndex
CREATE INDEX "TutorCandidate_modelFamily_externalModelId_idx" ON "TutorCandidate"("modelFamily", "externalModelId");

-- CreateIndex
CREATE UNIQUE INDEX "TutorCandidate_caseId_generationRunId_slot_key" ON "TutorCandidate"("caseId", "generationRunId", "slot");

-- CreateIndex
CREATE INDEX "TutorReviewTask_type_status_createdAt_idx" ON "TutorReviewTask"("type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TutorReviewTask_assignedToId_status_idx" ON "TutorReviewTask"("assignedToId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TutorReviewTask_caseId_type_key" ON "TutorReviewTask"("caseId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "FinalizedTutorTurn_caseId_key" ON "FinalizedTutorTurn"("caseId");

-- CreateIndex
CREATE INDEX "FinalizedTutorTurn_trainingEligibility_createdAt_idx" ON "FinalizedTutorTurn"("trainingEligibility", "createdAt");

-- CreateIndex
CREATE INDEX "FinalizedTutorTurn_contentSha256_idx" ON "FinalizedTutorTurn"("contentSha256");

-- CreateIndex
CREATE INDEX "StateExtractionTrace_conversationId_createdAt_idx" ON "StateExtractionTrace"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "StateExtractionTrace_extractorVersion_status_idx" ON "StateExtractionTrace"("extractorVersion", "status");

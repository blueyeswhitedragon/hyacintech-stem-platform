-- M9B1: stable model registry, deployment baseline, and immutable generation traces.
ALTER TABLE "Conversation" ADD COLUMN "traceCoverage" TEXT NOT NULL DEFAULT 'LEGACY_UNVERIFIED';

CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tag" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalModelId" TEXT NOT NULL,
    "parentModelVersionId" TEXT,
    "trainingRunId" TEXT,
    "promptPolicyVersion" TEXT NOT NULL DEFAULT 'stem-six-phase-v1',
    "contractVersion" TEXT NOT NULL DEFAULT 'chat-contract-v1',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModelVersion_parentModelVersionId_fkey" FOREIGN KEY ("parentModelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelVersion_trainingRunId_fkey" FOREIGN KEY ("trainingRunId") REFERENCES "TrainingRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ModelDeployment" (
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
    CONSTRAINT "ModelDeployment_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModelDeployment_previousModelVersionId_fkey" FOREIGN KEY ("previousModelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelDeployment_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "EvaluationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelDeployment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "GenerationTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "assistantMessageId" TEXT NOT NULL,
    "userMessageId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "modelTagSnapshot" TEXT NOT NULL,
    "providerSnapshot" TEXT NOT NULL,
    "externalModelSnapshot" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptSha256" TEXT NOT NULL,
    "styleFamily" TEXT NOT NULL,
    "stylePolicyVersion" TEXT NOT NULL,
    "requestMessageSha256" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL,
    "responseSha256" TEXT NOT NULL,
    "generationParamsJson" TEXT NOT NULL DEFAULT '{}',
    "contractVersion" TEXT NOT NULL,
    "contractCheckJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenerationTrace_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GenerationTrace_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ModelVersion_tag_key" ON "ModelVersion"("tag");
CREATE UNIQUE INDEX "ModelVersion_trainingRunId_key" ON "ModelVersion"("trainingRunId");
CREATE INDEX "ModelVersion_provider_externalModelId_idx" ON "ModelVersion"("provider", "externalModelId");
CREATE INDEX "ModelVersion_parentModelVersionId_idx" ON "ModelVersion"("parentModelVersionId");
CREATE INDEX "ModelVersion_status_idx" ON "ModelVersion"("status");
CREATE INDEX "ModelDeployment_environment_status_idx" ON "ModelDeployment"("environment", "status");
CREATE INDEX "ModelDeployment_modelVersionId_idx" ON "ModelDeployment"("modelVersionId");
CREATE UNIQUE INDEX "GenerationTrace_assistantMessageId_key" ON "GenerationTrace"("assistantMessageId");
CREATE INDEX "GenerationTrace_conversationId_createdAt_idx" ON "GenerationTrace"("conversationId", "createdAt");
CREATE INDEX "GenerationTrace_modelVersionId_createdAt_idx" ON "GenerationTrace"("modelVersionId", "createdAt");
CREATE INDEX "GenerationTrace_stage_idx" ON "GenerationTrace"("stage");

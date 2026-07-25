-- Split provider connections, served endpoints, immutable model artifacts,
-- executable Prompt policies and deployable runtime bundles without rewriting
-- historical Release, Trace or TutorTurnCase payloads.

CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'OPENAI_COMPATIBLE',
    "baseUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "capabilitiesJson" TEXT NOT NULL DEFAULT '{}',
    "lastTestedAt" DATETIME,
    "lastTestStatus" TEXT NOT NULL DEFAULT 'NOT_TESTED',
    "lastLatencyMs" INTEGER,
    "lastErrorCode" TEXT NOT NULL DEFAULT '',
    "lastErrorMessage" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderConnection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProviderConnection_name_key" ON "ProviderConnection"("name");
CREATE INDEX "ProviderConnection_status_updatedAt_idx" ON "ProviderConnection"("status", "updatedAt");

CREATE TABLE "ProviderCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "envVarName" TEXT NOT NULL DEFAULT '',
    "encryptedValue" TEXT NOT NULL DEFAULT '',
    "encryptionIv" TEXT NOT NULL DEFAULT '',
    "encryptionAuthTag" TEXT NOT NULL DEFAULT '',
    "keyLastFour" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProviderCredential_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ProviderConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProviderCredential_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProviderCredential_connectionId_key" ON "ProviderCredential"("connectionId");

CREATE TABLE "PromptPolicyVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "revisionOfId" TEXT,
    "rendererVersion" TEXT NOT NULL,
    "visibleStateVersion" TEXT NOT NULL,
    "focusPlannerVersion" TEXT NOT NULL,
    "semanticValidatorVersion" TEXT NOT NULL,
    "fallbackVersion" TEXT NOT NULL,
    "tutorContractVersion" TEXT NOT NULL,
    "stageContractVersion" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "extractorPromptVersion" TEXT NOT NULL,
    "sourceCommit" TEXT NOT NULL DEFAULT '',
    "manifestJson" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "compatibilityJson" TEXT NOT NULL DEFAULT '{}',
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "defaultForDataLab" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" DATETIME,
    "createdById" TEXT,
    "approvedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromptPolicyVersion_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "PromptPolicyVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PromptPolicyVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PromptPolicyVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PromptPolicyVersion_version_key" ON "PromptPolicyVersion"("version");
CREATE INDEX "PromptPolicyVersion_status_updatedAt_idx" ON "PromptPolicyVersion"("status", "updatedAt");
CREATE INDEX "PromptPolicyVersion_revisionOfId_revision_idx" ON "PromptPolicyVersion"("revisionOfId", "revision");
CREATE INDEX "PromptPolicyVersion_defaultForDataLab_idx" ON "PromptPolicyVersion"("defaultForDataLab");

ALTER TABLE "DatasetRelease" ADD COLUMN "trainingCohortJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "TrainingRun" ADD COLUMN "promptPolicyVersionId" TEXT;

ALTER TABLE "ModelVersion" ADD COLUMN "trainedPromptPolicyVersionId" TEXT;
ALTER TABLE "ModelVersion" ADD COLUMN "artifactKind" TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "ModelVersion" ADD COLUMN "modelFamily" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ModelVersion" ADD COLUMN "checkpointId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ModelVersion" ADD COLUMN "weightsSha256" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ModelVersion" ADD COLUMN "parameterScale" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ModelVersion" ADD COLUMN "architecture" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ModelVersion" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'LEGACY_UNVERIFIED';
ALTER TABLE "ModelVersion" ADD COLUMN "metadataJson" TEXT NOT NULL DEFAULT '{}';

CREATE INDEX "ModelVersion_modelFamily_verificationStatus_idx" ON "ModelVersion"("modelFamily", "verificationStatus");
CREATE INDEX "ModelVersion_trainedPromptPolicyVersionId_idx" ON "ModelVersion"("trainedPromptPolicyVersionId");

CREATE TABLE "ModelEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "remoteModelId" TEXT NOT NULL,
    "modelVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "capabilitiesJson" TEXT NOT NULL DEFAULT '{}',
    "lastTestedAt" DATETIME,
    "lastTestStatus" TEXT NOT NULL DEFAULT 'NOT_TESTED',
    "lastLatencyMs" INTEGER,
    "lastErrorCode" TEXT NOT NULL DEFAULT '',
    "lastErrorMessage" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModelEndpoint_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ProviderConnection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModelEndpoint_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModelEndpoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ModelEndpoint_connectionId_remoteModelId_key" ON "ModelEndpoint"("connectionId", "remoteModelId");
CREATE INDEX "ModelEndpoint_status_updatedAt_idx" ON "ModelEndpoint"("status", "updatedAt");
CREATE INDEX "ModelEndpoint_modelVersionId_idx" ON "ModelEndpoint"("modelVersionId");

CREATE TABLE "RuntimeBundle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "roleKey" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "promptPolicyVersionId" TEXT NOT NULL,
    "tutorContractVersion" TEXT NOT NULL,
    "stageContractVersion" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "generationParamsJson" TEXT NOT NULL DEFAULT '{}',
    "compatibilityReportJson" TEXT NOT NULL DEFAULT '{}',
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RuntimeBundle_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RuntimeBundle_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "ModelEndpoint" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RuntimeBundle_promptPolicyVersionId_fkey" FOREIGN KEY ("promptPolicyVersionId") REFERENCES "PromptPolicyVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RuntimeBundle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RuntimeBundle_name_version_key" ON "RuntimeBundle"("name", "version");
CREATE INDEX "RuntimeBundle_roleKey_status_idx" ON "RuntimeBundle"("roleKey", "status");
CREATE INDEX "RuntimeBundle_modelVersionId_promptPolicyVersionId_idx" ON "RuntimeBundle"("modelVersionId", "promptPolicyVersionId");
CREATE INDEX "RuntimeBundle_endpointId_idx" ON "RuntimeBundle"("endpointId");

CREATE TABLE "RuntimeRoleBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roleKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "defaultRuntimeBundleId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RuntimeRoleBinding_defaultRuntimeBundleId_fkey" FOREIGN KEY ("defaultRuntimeBundleId") REFERENCES "RuntimeBundle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RuntimeRoleBinding_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RuntimeRoleBinding_roleKey_key" ON "RuntimeRoleBinding"("roleKey");
CREATE INDEX "RuntimeRoleBinding_enabled_displayName_idx" ON "RuntimeRoleBinding"("enabled", "displayName");

CREATE TABLE "PromptCompatibility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptPolicyVersionId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "runtimeBundleId" TEXT,
    "evaluationRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "evidenceJson" TEXT NOT NULL DEFAULT '{}',
    "checkedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromptCompatibility_promptPolicyVersionId_fkey" FOREIGN KEY ("promptPolicyVersionId") REFERENCES "PromptPolicyVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PromptCompatibility_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PromptCompatibility_runtimeBundleId_fkey" FOREIGN KEY ("runtimeBundleId") REFERENCES "RuntimeBundle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PromptCompatibility_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "EvaluationRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PromptCompatibility_promptPolicyVersionId_modelVersionId_key" ON "PromptCompatibility"("promptPolicyVersionId", "modelVersionId");
CREATE INDEX "PromptCompatibility_status_updatedAt_idx" ON "PromptCompatibility"("status", "updatedAt");

ALTER TABLE "EvaluationRun" ADD COLUMN "runtimeBundleAId" TEXT;
ALTER TABLE "EvaluationRun" ADD COLUMN "runtimeBundleBId" TEXT;

ALTER TABLE "ModelDeployment" ADD COLUMN "runtimeBundleId" TEXT;
ALTER TABLE "ModelDeployment" ADD COLUMN "previousRuntimeBundleId" TEXT;
CREATE INDEX "ModelDeployment_runtimeBundleId_idx" ON "ModelDeployment"("runtimeBundleId");

ALTER TABLE "GenerationTrace" ADD COLUMN "runtimeBundleId" TEXT;
CREATE INDEX "GenerationTrace_runtimeBundleId_createdAt_idx" ON "GenerationTrace"("runtimeBundleId", "createdAt");

ALTER TABLE "Conversation" ADD COLUMN "deployedRuntimeBundleId" TEXT;

ALTER TABLE "BootstrapGenerationRun" ADD COLUMN "candidateARuntimeBundleId" TEXT;
ALTER TABLE "BootstrapGenerationRun" ADD COLUMN "candidateBRuntimeBundleId" TEXT;
ALTER TABLE "BootstrapGenerationRun" ADD COLUMN "promptPolicyVersionId" TEXT;
ALTER TABLE "BootstrapGenerationRun" ADD COLUMN "firstReviewMode" TEXT NOT NULL DEFAULT 'HUMAN';

ALTER TABLE "TutorTurnCase" ADD COLUMN "promptPolicyVersionId" TEXT;
CREATE INDEX "TutorTurnCase_promptPolicyVersionId_idx" ON "TutorTurnCase"("promptPolicyVersionId");

ALTER TABLE "TutorCandidate" ADD COLUMN "runtimeBundleId" TEXT;
CREATE INDEX "TutorCandidate_runtimeBundleId_idx" ON "TutorCandidate"("runtimeBundleId");

-- CreateTable
CREATE TABLE "TopicSourceCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceKey" TEXT NOT NULL,
    "familyKey" TEXT NOT NULL,
    "familyOverrideKey" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "resourceType" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "sourcePlatform" TEXT NOT NULL,
    "sourceResourceId" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "authorizationStatus" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
    "rawSourceJson" TEXT NOT NULL DEFAULT '{}',
    "legacyHintsJson" TEXT NOT NULL DEFAULT '{}',
    "qualitySignalsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TopicSourceCandidate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables while preserving every existing TopicCard and historical relation.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TopicCard" (
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
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "revisionOfId" TEXT,
    "activityMode" TEXT NOT NULL DEFAULT '',
    "contextModule" TEXT NOT NULL DEFAULT '',
    "disciplineAnchorsJson" TEXT NOT NULL DEFAULT '[]',
    "authenticNeed" TEXT NOT NULL DEFAULT '',
    "stakeholder" TEXT NOT NULL DEFAULT '',
    "engineeringGoal" TEXT NOT NULL DEFAULT '',
    "constraintsJson" TEXT NOT NULL DEFAULT '[]',
    "performanceCriteriaJson" TEXT NOT NULL DEFAULT '[]',
    "inquiryBridgesJson" TEXT NOT NULL DEFAULT '[]',
    "sourceCandidateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TopicCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TopicCard_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TopicCard_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "TopicCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TopicCard_sourceCandidateId_fkey" FOREIGN KEY ("sourceCandidateId") REFERENCES "TopicSourceCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TopicCard" ("acceptableDirectionsJson", "approvedAt", "approvedById", "compilerEvidenceJson", "coreMechanism", "createdAt", "createdById", "curriculumAnchorsJson", "displayTitle", "forbiddenDirectionsJson", "gradeBand", "id", "internalArchetype", "rejectionReason", "sourceJson", "status", "studentOpening", "subject", "updatedAt") SELECT "acceptableDirectionsJson", "approvedAt", "approvedById", "compilerEvidenceJson", "coreMechanism", "createdAt", "createdById", "curriculumAnchorsJson", "displayTitle", "forbiddenDirectionsJson", "gradeBand", "id", "internalArchetype", "rejectionReason", "sourceJson", "status", "studentOpening", "subject", "updatedAt" FROM "TopicCard";
DROP TABLE "TopicCard";
ALTER TABLE "new_TopicCard" RENAME TO "TopicCard";
CREATE INDEX "TopicCard_status_subject_idx" ON "TopicCard"("status", "subject");
CREATE INDEX "TopicCard_approvedAt_idx" ON "TopicCard"("approvedAt");
CREATE INDEX "TopicCard_schemaVersion_status_idx" ON "TopicCard"("schemaVersion", "status");
CREATE INDEX "TopicCard_contextModule_activityMode_idx" ON "TopicCard"("contextModule", "activityMode");
CREATE INDEX "TopicCard_revisionOfId_revision_idx" ON "TopicCard"("revisionOfId", "revision");
CREATE INDEX "TopicCard_sourceCandidateId_idx" ON "TopicCard"("sourceCandidateId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndexes
CREATE UNIQUE INDEX "TopicSourceCandidate_sourceKey_key" ON "TopicSourceCandidate"("sourceKey");
CREATE INDEX "TopicSourceCandidate_status_createdAt_idx" ON "TopicSourceCandidate"("status", "createdAt");
CREATE INDEX "TopicSourceCandidate_familyKey_idx" ON "TopicSourceCandidate"("familyKey");
CREATE INDEX "TopicSourceCandidate_familyOverrideKey_idx" ON "TopicSourceCandidate"("familyOverrideKey");
CREATE INDEX "TopicSourceCandidate_authorizationStatus_idx" ON "TopicSourceCandidate"("authorizationStatus");

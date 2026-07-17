ALTER TABLE "BootstrapGenerationRun" ADD COLUMN "reviewPolicy" TEXT NOT NULL DEFAULT 'HUMAN_ANNOTATOR_REQUIRED';
ALTER TABLE "BootstrapGenerationRun" ADD COLUMN "aiDirectAuthorizedById" TEXT;
ALTER TABLE "BootstrapGenerationRun" ADD COLUMN "aiDirectAuthorizedAt" DATETIME;

ALTER TABLE "TutorTurnCase" ADD COLUMN "revisionOfId" TEXT;
ALTER TABLE "TutorTurnCase" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "TutorReviewTask" ADD COLUMN "submissionMode" TEXT NOT NULL DEFAULT 'HUMAN';
ALTER TABLE "TutorReviewTask" ADD COLUMN "authorizedById" TEXT;
ALTER TABLE "TutorReviewTask" ADD COLUMN "caseIssueJson" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "FinalizedTutorTurn" ADD COLUMN "reviewerEditMetricsJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "FinalizedTutorTurn" ADD COLUMN "draftProvenance" TEXT NOT NULL DEFAULT 'LEGACY_DOUBLE_REVIEW';
ALTER TABLE "FinalizedTutorTurn" ADD COLUMN "draftPreparedById" TEXT;
ALTER TABLE "FinalizedTutorTurn" ADD COLUMN "humanReviewerId" TEXT;

CREATE INDEX "BootstrapGenerationRun_reviewPolicy_status_createdAt_idx" ON "BootstrapGenerationRun"("reviewPolicy", "status", "createdAt");
CREATE INDEX "TutorTurnCase_revisionOfId_revision_idx" ON "TutorTurnCase"("revisionOfId", "revision");
CREATE INDEX "TutorReviewTask_submissionMode_status_idx" ON "TutorReviewTask"("submissionMode", "status");

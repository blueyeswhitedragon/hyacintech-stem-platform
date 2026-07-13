ALTER TABLE "AnnotationRevision" ADD COLUMN "transformationType" TEXT NOT NULL DEFAULT 'UNCLASSIFIED';
ALTER TABLE "AnnotationRevision" ADD COLUMN "transformationMetricsJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "DatasetRelease" ADD COLUMN "preferencePath" TEXT;
ALTER TABLE "DatasetRelease" ADD COLUMN "preferenceSha256" TEXT;
ALTER TABLE "DatasetRelease" ADD COLUMN "eligibilityReportJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "DatasetReleaseItem" ADD COLUMN "trainingEligibility" TEXT NOT NULL DEFAULT 'SFT_ALLOWED';
ALTER TABLE "DatasetReleaseItem" ADD COLUMN "eligibilityReasonJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "TrainingRun" ADD COLUMN "parentModelVersionId" TEXT;
ALTER TABLE "TrainingRun" ADD COLUMN "eligibilityReportJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "TrainingRun" ADD COLUMN "policyVersion" TEXT NOT NULL DEFAULT 'training-policy-v1';

CREATE INDEX "TrainingRun_parentModelVersionId_idx" ON "TrainingRun"("parentModelVersionId");

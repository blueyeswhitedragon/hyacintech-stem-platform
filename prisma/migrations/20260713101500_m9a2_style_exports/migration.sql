-- M9A2: carry style provenance into revisions, frozen releases and evaluations.
ALTER TABLE "AnnotationRevision" ADD COLUMN "styleFamily" TEXT;
ALTER TABLE "AnnotationRevision" ADD COLUMN "stylePolicyVersion" TEXT;

ALTER TABLE "DatasetRelease" ADD COLUMN "trainingPath" TEXT;
ALTER TABLE "DatasetRelease" ADD COLUMN "trainingSha256" TEXT;

ALTER TABLE "DatasetReleaseItem" ADD COLUMN "styleFamily" TEXT;
ALTER TABLE "DatasetReleaseItem" ADD COLUMN "stylePolicyVersion" TEXT;

ALTER TABLE "EvaluationRun" ADD COLUMN "styleFamily" TEXT;
ALTER TABLE "EvaluationRun" ADD COLUMN "stylePolicyVersion" TEXT;

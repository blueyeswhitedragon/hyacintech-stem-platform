-- M9A1: persist assignment, conversation and Data Lab style policy snapshots.
ALTER TABLE "Assignment" ADD COLUMN "assistantStyleFamily" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "Assignment" ADD COLUMN "stylePolicyVersion" TEXT NOT NULL DEFAULT 'style-v1';

ALTER TABLE "Conversation" ADD COLUMN "resolvedStyleFamily" TEXT NOT NULL DEFAULT 'classroom_coach';
ALTER TABLE "Conversation" ADD COLUMN "stylePolicyVersion" TEXT NOT NULL DEFAULT 'style-v1';

ALTER TABLE "AnnotationCampaign" ADD COLUMN "stylePolicyVersion" TEXT NOT NULL DEFAULT 'style-v1';
ALTER TABLE "AnnotationTask" ADD COLUMN "stylePolicyVersion" TEXT NOT NULL DEFAULT 'style-v1';

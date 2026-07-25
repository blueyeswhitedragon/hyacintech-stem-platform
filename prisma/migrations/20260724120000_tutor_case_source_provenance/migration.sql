-- Preserve the historical production-trace Prompt/contract separately from
-- the Data Lab training target contract used for review and release.
ALTER TABLE "TutorTurnCase" ADD COLUMN "sourceContractVersion" TEXT;
ALTER TABLE "TutorTurnCase" ADD COLUMN "sourceStageContractVersion" TEXT;
ALTER TABLE "TutorTurnCase" ADD COLUMN "sourceExtractorVersion" TEXT;
ALTER TABLE "TutorTurnCase" ADD COLUMN "sourcePromptVersion" TEXT;
ALTER TABLE "TutorTurnCase" ADD COLUMN "sourcePromptSha256" TEXT;
ALTER TABLE "TutorTurnCase" ADD COLUMN "sourceSystemPrompt" TEXT;

-- Distinguish real student turns from system-driven stage entry/transition generations.
ALTER TABLE "GenerationTrace" ADD COLUMN "triggerType" TEXT NOT NULL DEFAULT 'USER_MESSAGE';
ALTER TABLE "GenerationTrace" ADD COLUMN "systemPromptSnapshot" TEXT NOT NULL DEFAULT '';

CREATE INDEX "GenerationTrace_triggerType_createdAt_idx" ON "GenerationTrace"("triggerType", "createdAt");

-- Historical ModelVersion rows are intentionally left untouched. A prompt or
-- contract change is registered as a new version by model:bootstrap so past
-- evaluations and deployments remain truthful.

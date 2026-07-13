-- Distinguish real student turns from system-driven stage entry/transition generations.
ALTER TABLE "GenerationTrace" ADD COLUMN "triggerType" TEXT NOT NULL DEFAULT 'USER_MESSAGE';
ALTER TABLE "GenerationTrace" ADD COLUMN "systemPromptSnapshot" TEXT NOT NULL DEFAULT '';

CREATE INDEX "GenerationTrace_triggerType_createdAt_idx" ON "GenerationTrace"("triggerType", "createdAt");

-- Existing deployed model rows must describe the prompt/contract actually used after this refactor.
UPDATE "ModelVersion"
SET "promptPolicyVersion" = 'stem-six-phase-v2',
    "contractVersion" = 'stage-contract-v2'
WHERE "promptPolicyVersion" = 'stem-six-phase-v1'
   OR "contractVersion" = 'chat-contract-v1';

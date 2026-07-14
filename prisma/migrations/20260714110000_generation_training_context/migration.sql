-- Preserve the exact model-visible context only for explicitly consented turns.
-- Historical traces remain empty and therefore cannot become positive SFT data.
ALTER TABLE "GenerationTrace"
ADD COLUMN "trainingSystemPromptSnapshot" TEXT NOT NULL DEFAULT '';

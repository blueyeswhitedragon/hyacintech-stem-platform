ALTER TABLE "Conversation" ADD COLUMN "deployedModelVersionId" TEXT;
ALTER TABLE "EvaluationRun" ADD COLUMN "modelAVersionId" TEXT;
ALTER TABLE "EvaluationRun" ADD COLUMN "modelBVersionId" TEXT;
ALTER TABLE "EvaluationRun" ADD COLUMN "gateResult" TEXT NOT NULL DEFAULT 'NOT_EVALUATED';
ALTER TABLE "EvaluationRun" ADD COLUMN "gateReportJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "ModelDeployment" ADD COLUMN "gateReportJson" TEXT NOT NULL DEFAULT '{}';

CREATE INDEX "Conversation_deployedModelVersionId_idx" ON "Conversation"("deployedModelVersionId");
CREATE INDEX "EvaluationRun_modelAVersionId_idx" ON "EvaluationRun"("modelAVersionId");
CREATE INDEX "EvaluationRun_modelBVersionId_idx" ON "EvaluationRun"("modelBVersionId");
CREATE INDEX "EvaluationRun_gateResult_idx" ON "EvaluationRun"("gateResult");

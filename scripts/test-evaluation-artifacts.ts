import { readFile } from 'fs/promises';
import path from 'path';
import { validateEvaluationArtifacts, type ImportedEvaluationArtifact } from '../app/lib/dataLab/evaluationArtifacts';
import { evaluateDeploymentGate } from '../app/lib/deploymentGate';

let passed = 0;
let failed = 0;

function check(condition: unknown, message: string) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${message}`);
  } else {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

async function sample(name: string) {
  const raw = await readFile(path.join(process.cwd(), 'public', 'samples', name), 'utf8');
  return JSON.parse(raw) as ImportedEvaluationArtifact;
}

async function main() {
  const baseline = await sample('evaluation-baseline-transcript.json');
  const candidate = await sample('evaluation-candidate-transcript.json');
  const verdict = await sample('evaluation-verdict.json');
  const valid = validateEvaluationArtifacts({ verdict, transcripts: [baseline, candidate] });
  check(valid.complete && valid.scenarioCount === 6, '新版三件套通过身份、scenarioId、六阶段与 parse 校验');

  const oldVerdict = { ...verdict, summary: {} };
  const old = validateEvaluationArtifacts({ verdict: oldVerdict, transcripts: [baseline, candidate] });
  check(!old.complete && old.diagnostics.some((item) => item.code === 'PHASE_SUMMARY_MISSING'), '旧 verdict 可被识别为产物字段缺失');

  const mismatchedCandidate = { ...candidate, tag: 'wrong-tag' };
  const mismatch = validateEvaluationArtifacts({ verdict, transcripts: [baseline, mismatchedCandidate] });
  check(!mismatch.modelIdentitiesVerified && mismatch.diagnostics.some((item) => item.code === 'MODEL_IDENTITIES_MISMATCH'), 'A/B 身份错配不会被标为完整产物');

  const summary = verdict.summary as { phase: Record<string, Record<string, number>>; criticalErrors: number };
  const gate = evaluateDeploymentGate({
    candidateTag: 'candidate-bundle:v1',
    trainingReady: true,
    runs: [{
      id: 'sample-run',
      modelATag: 'baseline-bundle:v1',
      modelBTag: 'candidate-bundle:v1',
      summary: { ...summary, artifactValidation: valid },
    }],
  });
  check(gate.result === 'PASS', '合规六阶段产物的部署门禁得到 PASS 而非 INSUFFICIENT');

  console.log(`\nEvaluation artifact tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

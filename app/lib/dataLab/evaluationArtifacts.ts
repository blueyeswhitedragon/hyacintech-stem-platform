export interface EvaluationArtifactDiagnostic {
  code: 'PHASE_SUMMARY_MISSING' | 'PHASE_SUMMARY_INCOMPLETE' | 'PARSE_METRICS_MISSING' | 'SCENARIO_IDS_MISMATCH' | 'MODEL_IDENTITIES_MISMATCH';
  category: 'PRODUCT_INCOMPLETE' | 'ARTIFACT_MISMATCH';
  message: string;
  remediation: string;
}

export interface ImportedEvaluationArtifact {
  schemaVersion?: number;
  tag?: string;
  scope?: string;
  tags?: { A?: string; B?: string };
  summary?: unknown;
  styleFamily?: string;
  stylePolicyVersion?: string;
  scenarios?: unknown;
  scenarioVerdicts?: unknown;
  turnVerdicts?: unknown;
}

const PHASES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const;
const PARSE_FIELDS = ['parseSuccessA', 'parseTotalA', 'parseSuccessB', 'parseTotalB'] as const;
const COUNT_FIELDS = ['A', 'B', 'tie', 'inconsistent', 'criticalErrors'] as const;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function scenarioIds(artifact: ImportedEvaluationArtifact) {
  const ids = new Set<string>();
  const scenarios = Array.isArray(artifact.scenarios) ? artifact.scenarios : [];
  for (const rawScenario of scenarios) {
    const scenario = objectValue(rawScenario);
    if (!scenario) continue;
    if (typeof scenario.id === 'string' && scenario.id.trim()) ids.add(scenario.id.trim());
    if (typeof scenario.scenarioId === 'string' && scenario.scenarioId.trim()) ids.add(scenario.scenarioId.trim());
    const turns = Array.isArray(scenario.turns) ? scenario.turns : [];
    for (const rawTurn of turns) {
      const turn = objectValue(rawTurn);
      if (typeof turn?.scenarioId === 'string' && turn.scenarioId.trim()) ids.add(turn.scenarioId.trim());
    }
  }
  return ids;
}

function verdictScenarioIds(artifact: ImportedEvaluationArtifact) {
  const ids = new Set<string>();
  const verdicts = Array.isArray(artifact.scenarioVerdicts) ? artifact.scenarioVerdicts : [];
  for (const rawVerdict of verdicts) {
    const verdict = objectValue(rawVerdict);
    if (typeof verdict?.id === 'string' && verdict.id.trim()) ids.add(verdict.id.trim());
  }
  return ids;
}

function sameSet(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function normalizedPhaseSummary(summary: unknown) {
  const phase = objectValue(objectValue(summary)?.phase);
  if (!phase) return null;
  return Object.fromEntries(Object.entries(phase).map(([key, value]) => {
    const number = Number(key.replace(/^P/i, ''));
    return [`P${number}`, value];
  }));
}

export function validateEvaluationArtifacts(input: {
  verdict: ImportedEvaluationArtifact;
  transcripts: ImportedEvaluationArtifact[];
  expectedTags?: { A: string; B: string };
}) {
  const diagnostics: EvaluationArtifactDiagnostic[] = [];
  const tags = input.verdict.tags;
  const transcriptTags = new Set(input.transcripts.map((item) => item.tag).filter((value): value is string => Boolean(value)));
  const identitiesMatch = Boolean(tags?.A && tags.B
    && transcriptTags.size === 2
    && transcriptTags.has(tags.A)
    && transcriptTags.has(tags.B)
    && (!input.expectedTags || (tags.A === input.expectedTags.A && tags.B === input.expectedTags.B)));
  if (!identitiesMatch) diagnostics.push({
    code: 'MODEL_IDENTITIES_MISMATCH',
    category: 'ARTIFACT_MISMATCH',
    message: '评测产物中的 A/B 模型身份与两份 transcript 或已冻结运行组合不一致。',
    remediation: '重新导出同一次评测的三个文件，并确认 A/B 标签与离线评测任务完全一致。',
  });

  const transcriptScenarioSets = input.transcripts.map(scenarioIds);
  const verdictScenarios = verdictScenarioIds(input.verdict);
  const scenarioIdsComplete = transcriptScenarioSets.length === 2
    && transcriptScenarioSets.every((ids) => ids.size > 0)
    && verdictScenarios.size > 0
    && sameSet(transcriptScenarioSets[0], transcriptScenarioSets[1])
    && sameSet(transcriptScenarioSets[0], verdictScenarios);
  if (!scenarioIdsComplete) diagnostics.push({
    code: 'SCENARIO_IDS_MISMATCH',
    category: 'ARTIFACT_MISMATCH',
    message: '两份 transcript 与 verdict 引用的 scenarioId 不能一一对应。',
    remediation: '使用同一 scope 重新生成 A/B transcript 与 verdict，不要混用不同批次或筛选范围的文件。',
  });

  const phase = normalizedPhaseSummary(input.verdict.summary);
  if (!phase) diagnostics.push({
    code: 'PHASE_SUMMARY_MISSING',
    category: 'PRODUCT_INCOMPLETE',
    message: '评测产物缺少逐阶段字段，请用新版 blind-eval 重新生成。',
    remediation: '运行新版 scripts/blind-eval.ts judge，确保 verdict.summary.phase 包含 P1-P6。',
  });
  const phaseSummaryComplete = Boolean(phase && PHASES.every((key) => {
    const counts = objectValue(phase[key]);
    return counts && COUNT_FIELDS.every((field) => typeof counts[field] === 'number');
  }));
  if (phase && !phaseSummaryComplete) diagnostics.push({
    code: 'PHASE_SUMMARY_INCOMPLETE',
    category: 'PRODUCT_INCOMPLETE',
    message: '逐阶段裁决统计不完整，P1-P6 必须都包含胜负、平局、不一致和关键错误计数。',
    remediation: '使用新版 blind-eval 重新生成 verdict，不要手工删除 summary.phase 字段。',
  });
  const parseMetricsComplete = Boolean(phase && PHASES.every((key) => {
    const counts = objectValue(phase[key]);
    return counts && PARSE_FIELDS.every((field) => typeof counts[field] === 'number');
  }));
  if (phase && !parseMetricsComplete) diagnostics.push({
    code: 'PARSE_METRICS_MISSING',
    category: 'PRODUCT_INCOMPLETE',
    message: '逐阶段统计缺少 A/B 结构解析成功率，部署资格无法计算。',
    remediation: '使用新版 blind-eval 重新生成 verdict，使每个阶段包含 parseSuccessA/parseTotalA/parseSuccessB/parseTotalB。',
  });

  return {
    complete: diagnostics.length === 0,
    invalidArtifacts: diagnostics.length,
    scenarioIdsComplete,
    modelIdentitiesVerified: identitiesMatch,
    phaseSummaryComplete,
    parseMetricsComplete,
    scenarioCount: transcriptScenarioSets[0]?.size ?? 0,
    diagnostics,
  };
}

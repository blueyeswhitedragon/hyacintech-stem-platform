import type { ChatResponse, SafetyQuiz } from '@/app/models/types';
import type { Stage2RiskAnnotation, StageData } from '@/app/models/stageData';
import { buildDataTableSchema, composeReportSections } from '@/app/lib/stageArtifacts';
import type { TutorServerEnvelope } from '@/app/lib/tutorLanguage';

export interface TutorFocusPlan {
  allowedFocusIds: string[];
  focusDescriptions: Record<string, string>;
}

function fact(stageData: StageData, field: string): unknown {
  return stageData.extractedFacts?.[field]?.value;
}

export function tutorFocusPlan(stage: number, stageData: StageData, input: { triggerType?: string; analysisAccepted?: boolean } = {}): TutorFocusPlan {
  const descriptions: Record<string, string> = {};
  const add = (id: string, description: string) => {
    descriptions[id] = description;
    return id;
  };
  if (stage === 1) {
    const ids: string[] = [];
    if (!fact(stageData, 'stage1.originalInterest')) ids.push(add('interest', '回应学生兴趣并澄清想研究的现象'));
    if (!fact(stageData, 'stage1.retainedFeature')) ids.push(add('mechanism', '帮助学生说清想保留的真实机制或约束'));
    if (!fact(stageData, 'stage1.researchQuestion')) ids.push(add('research_question', '帮助学生用自己的话形成可探究问题'));
    if (!fact(stageData, 'stage1.factorDirection') || !fact(stageData, 'stage1.phenomenonDirection')) ids.push(add('direction', '澄清拟改变因素方向和关注现象方向，不给水平或测量答案'));
    if (ids.length === 0 || !stageData.stage1?.confirmed) ids.push(add('direction_confirmation', '请学生核对服务器已掌握的方向是否准确'));
    return { allowedFocusIds: [...new Set(ids)], focusDescriptions: descriptions };
  }
  if (stage === 2) {
    const fields: Array<[string, string, string]> = [
      ['stage2.hypothesis', 'hypothesis', '澄清学生自己的假设'],
      ['stage2.independentVariable.name', 'independent_variable', '澄清要改变的一个因素'],
      ['stage2.independentVariable.levels', 'levels', '澄清学生选择的至少两个水平'],
      ['stage2.dependentVariable.measurement', 'measurement', '澄清怎样观察或测量结果'],
      ['stage2.controlledVariables', 'controls', '澄清需要保持一致的条件'],
      ['stage2.procedure', 'procedure', '澄清可执行步骤'],
      ['stage2.repeatCount', 'repeats', '澄清每个水平的重复次数'],
      ['stage2.safetyNotes', 'safety', '澄清学生已识别的安全注意事项'],
    ];
    const ids = fields.filter(([field]) => fact(stageData, field) === undefined).slice(0, 2).map(([, id, desc]) => add(id, desc));
    if (ids.length === 0 || !stageData.stage2?.factsConfirmed) ids.push(add('plan_confirmation', '请学生核对由其事实组装的方案，不代替教师审批'));
    return { allowedFocusIds: [...new Set(ids)], focusDescriptions: descriptions };
  }
  if (stage === 3) {
    const id = input.triggerType === 'STAGE_ENTER'
      ? add('safety_checkpoint', '自然引导学生完成平台给出的确定性安全题')
      : add('execution_support', '围绕真实记录、异常和安全执行提供简短辅导');
    return { allowedFocusIds: [id], focusDescriptions: descriptions };
  }
  if (stage === 4) {
    const id = input.analysisAccepted
      ? add('interpret_evidence', '回应学生刚刚引用的真实数据，邀请其解释但不代写结论')
      : add('cite_evidence', '请学生引用表中真实数值完成一个具体比较');
    return { allowedFocusIds: [id], focusDescriptions: descriptions };
  }
  if (stage === 5) {
    const id = input.triggerType === 'REPORT_BOOTSTRAP'
      ? add('report_handoff', '说明平台已依据前序状态生成可核对框架，并指出仍需学生完成的内容')
      : add('report_gap', '只核对一个缺失或不一致处，不代写最终结论');
    return { allowedFocusIds: [id], focusDescriptions: descriptions };
  }
  return { allowedFocusIds: [add('reflection_coaching', '提供可选反思辅导，保留学生原文和决定权')], focusDescriptions: descriptions };
}

function deterministicRisks(stageData: StageData): Stage2RiskAnnotation[] {
  const plan = stageData.stage2?.experimentPlan;
  if (!plan) return [];
  const text = [...plan.materials, ...plan.procedure, ...plan.safetyNotes].join('');
  const risks: Stage2RiskAnnotation[] = [];
  if (/加热|热水|火|灯/.test(text)) risks.push({ description: '涉及热源或光源时需由教师确认低温、低压和防烫措施。', severity: 'medium' });
  if (/玻璃|剪|刀/.test(text)) risks.push({ description: '易碎或尖锐器材需在教师指导下使用。', severity: 'medium' });
  if (/溶液|药品|粉末/.test(text)) risks.push({ description: '实验材料不得入口，接触后应洗手并保持通风。', severity: 'low' });
  if (risks.length === 0) risks.push({ description: '保持台面整洁，材料不得入口，异常时立即停止并告知教师。', severity: 'low' });
  return risks;
}

function deterministicSafetyQuiz(stageData: StageData): SafetyQuiz {
  const risks = deterministicRisks(stageData);
  const main = risks[0]?.description ?? '异常时立即停止并告知教师';
  return {
    question: `实验中出现异常情况时，哪种做法最符合本方案的安全要求？（提示：${main}）`,
    options: ['立即停止操作并告知教师', '继续完成本轮再处理', '自行更换更强的材料'],
    correct: 0,
  };
}

function dataValues(stageData: StageData): string[] {
  return (stageData.stage3?.rows ?? []).flatMap((row) => Object.values(row)).filter((value) => typeof value === 'number' || (typeof value === 'string' && value.trim())).map(String);
}

export function updateServerAnalysis(stageData: StageData, studentMessage: string): { stageData: StageData; accepted: boolean; matchedValues: string[] } {
  const values = [...new Set(dataValues(stageData))];
  const matchedValues = values.filter((value) => studentMessage.includes(value));
  const comparison = /比|相比|高于|低于|增加|减少|上升|下降|最多|最少|差|相同|不同/.test(studentMessage);
  const accepted = matchedValues.length >= 2 && comparison;
  if (!accepted) return { stageData, accepted, matchedValues };
  const previous = stageData.stage4 ?? { analysisCount: 0 };
  return {
    accepted,
    matchedValues,
    stageData: {
      ...stageData,
      stage4: {
        ...previous,
        analysisCount: previous.analysisCount + 1,
        observations: [...(previous.observations ?? []), studentMessage],
        evidenceCitations: [...(previous.evidenceCitations ?? []), ...matchedValues],
        evidenceRounds: [...(previous.evidenceRounds ?? []), {
          observation: studentMessage,
          citations: matchedValues,
          matchedValues,
        }],
      },
    },
  };
}

export function attachServerOwnedArtifacts(input: {
  stage: number;
  stageData: StageData;
  triggerType: string;
  safetyQuizCompleted?: boolean;
}): { stageData: StageData; envelope: TutorServerEnvelope } {
  let stageData = input.stageData;
  const artifacts: TutorServerEnvelope['artifacts'] = {};
  let nextActionType: ChatResponse['next_action_type'] | undefined;
  let phaseComplete = false;

  if (input.stage === 1 && stageData.stage1?.confirmed) {
    artifacts.stage1_confirmed = true;
    artifacts.snapshot = stageData.stage1.snapshot;
    artifacts.theme_mapping = stageData.stage1.themeMapping;
    artifacts.topic_direction = {
      factor: stageData.stage1.factorDirection ?? stageData.stage1.variables.independent,
      phenomenon: stageData.stage1.phenomenonDirection ?? '',
    };
    nextActionType = 'confirmation';
    phaseComplete = true;
  }

  if (input.stage === 2 && stageData.stage2?.experimentPlan && stageData.stage2.factsConfirmed) {
    const plan = stageData.stage2.experimentPlan;
    const schema = buildDataTableSchema(plan);
    if (!schema) throw new Error('服务器无法根据已确认方案生成数据表');
    const risks = deterministicRisks(stageData);
    stageData = {
      ...stageData,
      stage2: { ...stageData.stage2, schema, aiRiskAnnotations: risks },
    };
    artifacts.experiment_plan = plan;
    artifacts.data_table_schema = schema;
    artifacts.risks = risks;
    artifacts.artifact_provenance = { data_table_schema: 'server_composed' };
    nextActionType = 'confirmation';
    phaseComplete = true;
  }

  if (input.stage === 3 && !input.safetyQuizCompleted && input.triggerType === 'STAGE_ENTER') {
    const quiz = deterministicSafetyQuiz(stageData);
    stageData = {
      ...stageData,
      stage3: {
        ...(stageData.stage3 ?? { rows: [] }),
        safetyQuiz: {
          ...quiz,
          passed: stageData.stage3?.safetyQuiz?.passed ?? false,
        },
      },
    };
    artifacts.safety_quiz = quiz;
    nextActionType = 'info';
  }

  if (input.stage === 5 && input.triggerType === 'REPORT_BOOTSTRAP') {
    const sections = composeReportSections({ stageData });
    if (sections) {
      stageData = {
        ...stageData,
        stage5: {
          submitted: stageData.stage5?.submitted ?? false,
          approved: stageData.stage5?.approved ?? null,
          teacherFeedback: stageData.stage5?.teacherFeedback,
          sections: {
            ...sections,
            conclusion: stageData.stage5?.sections?.conclusion ?? '',
            reflection: stageData.stage5?.sections?.reflection ?? '',
          },
        },
      };
      artifacts.report_sections = sections;
      artifacts.artifact_provenance = { ...(artifacts.artifact_provenance ?? {}), report_sections: 'server_composed' };
      nextActionType = 'info';
    }
  }

  return { stageData, envelope: { nextActionType, phaseComplete, artifacts } };
}

export function visibleDataRows(stageData: StageData): Array<Record<string, unknown>> {
  const rows = stageData.stage3?.rows ?? [];
  const columns = stageData.stage2?.schema.columns ?? [];
  return rows.map((row, index) => Object.fromEntries([
    ['行号', index + 1],
    ...columns.map((column) => [column.title, row[column.key]] as const),
  ]));
}

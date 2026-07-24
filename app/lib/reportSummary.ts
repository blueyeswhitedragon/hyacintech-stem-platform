import type { StageData } from '@/app/models/stageData';
import { limitationsDiscussion } from '@/app/lib/reportFields';

/** 给阶段5用：把前序阶段内容压成一段文本摘要。 */
export function buildPriorSummary(stageData: StageData): string {
  const parts: string[] = [];

  if (stageData.stage1?.snapshot) {
    parts.push(`【选题确认书】\n${stageData.stage1.snapshot}`);
    if (stageData.stage1.themeMapping) {
      const m = stageData.stage1.themeMapping;
      parts.push(
        `【课题转化链】原始兴趣：${m.originalInterest}；保留特征：${m.retainedFeature}；课堂代理：${m.classroomProxy}；研究问题：${m.researchQuestion}`
      );
    }
    const factor = stageData.stage1.factorDirection?.trim() || stageData.stage1.variables?.independent?.trim();
    const phenomenon = stageData.stage1.phenomenonDirection?.trim();
    if (factor || phenomenon) {
      parts.push(`拟改变因素方向：${factor || '待第二阶段确认'}；关注现象方向：${phenomenon || '待第二阶段确认'}`);
    }
  }

  if (stageData.stage2?.experimentPlan) {
    const plan = stageData.stage2.experimentPlan;
    parts.push([
      '【结构化实验方案】',
      plan.researchQuestion ? `研究问题：${plan.researchQuestion}` : '',
      plan.hypothesis ? `假设：${plan.hypothesis}` : '',
      `自变量：${plan.independentVariable.name}；水平：${plan.independentVariable.levels.join('、')}`,
      `因变量：${plan.dependentVariable.name}；测量方式：${plan.dependentVariable.measurement}${plan.dependentVariable.unit ? `；单位：${plan.dependentVariable.unit}` : ''}`,
      `控制变量：${plan.controlledVariables.join('、') || '无'}`,
      `材料：${plan.materials.join('、') || '待补充'}`,
      `步骤：${plan.procedure.join('；') || '待补充'}`,
      `每个水平重复：${plan.repeatCount}次`,
      `安全：${plan.safetyNotes.join('；') || '无特殊风险'}`,
    ].filter(Boolean).join('\n'));
  }

  if (stageData.stage2?.schema) {
    const cols = stageData.stage2.schema.columns.map((c) => `${c.title}(${c.type})`).join('、');
    parts.push(`【实验方案-数据表列】${cols}，最少${stageData.stage2.schema.minRows}行，最多${stageData.stage2.schema.maxRows}行`);
  }

  if (stageData.stage3?.rows?.length) {
    const keys = stageData.stage2?.schema?.columns.map((c) => c.key) ?? Object.keys(stageData.stage3.rows[0]);
    const titles = stageData.stage2?.schema?.columns.map((c) => c.title) ?? keys;
    const header = titles.join(' | ');
    const body = stageData.stage3.rows
      .map((row, i) => `${i + 1}. ` + keys.map((k) => String(row[k] ?? '')).join(' | '))
      .join('\n');
    parts.push(`【实验数据-共${stageData.stage3.rows.length}行】\n${header}\n${body}`);
  }

  if (stageData.stage4) {
    const analysis = stageData.stage4;
    parts.push([
      '【数据分析进度】',
      `有效分析轮次：${analysis.analysisCount}`,
      analysis.observations?.length ? `学生观察：${analysis.observations.join('；')}` : '',
      analysis.evidenceCitations?.length ? `数据证据：${analysis.evidenceCitations.join('；')}` : '',
      analysis.anomalies?.length ? `异常与不确定性：${analysis.anomalies.join('；')}` : '',
      analysis.interpretations?.length ? `当前解释：${analysis.interpretations.join('；')}` : '',
    ].filter(Boolean).join('\n'));
  }

  if (stageData.stage5?.sections) {
    const report = stageData.stage5.sections;
    parts.push([
      '【学生报告】',
      `目的：${report.purpose}`,
      `假设：${report.hypothesis}`,
      `材料：${report.materials}`,
      `步骤：${report.procedure}`,
      `数据概述：${report.dataSummary}`,
      `分析：${report.analysis}`,
      `学生结论：${report.conclusion || '待填写'}`,
      `局限与讨论：${limitationsDiscussion(report) || '待填写'}`,
      stageData.stage5.teacherScore !== undefined ? `教师评分：${stageData.stage5.teacherScore}` : '',
      stageData.stage5.teacherFeedback?.trim() ? `教师反馈：${stageData.stage5.teacherFeedback.trim()}` : '',
    ].filter(Boolean).join('\n'));
  }

  if (stageData.stage6) {
    parts.push([
      '【结果反思】',
      `对教师评价的回应：${stageData.stage6.responseToTeacherFeedback || stageData.stage6.studentResponse || '待填写'}`,
      `学习反思：${stageData.stage6.learningReflection || stageData.stage6.studentResponse || '待填写'}`,
    ].join('\n'));
  }

  return parts.join('\n\n') || '（前序阶段暂无结构化摘要，请参考对话历史）';
}

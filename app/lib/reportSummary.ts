import type { StageData } from '@/app/models/stageData';

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
    if (stageData.stage1.variables) {
      const v = stageData.stage1.variables;
      const controlled = v.controlled?.length
        ? `，控制变量：${v.controlled.join('、')}`
        : '';
      const dependent = v.dependent?.trim() ? v.dependent : '待第二阶段确定';
      parts.push(
        `自变量：${v.independent}，因变量：${dependent}${controlled}`
      );
    }
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

  return parts.join('\n\n') || '（前序阶段暂无结构化摘要，请参考对话历史）';
}

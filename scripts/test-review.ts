/**
 * 确定性单测：applyReview 状态机（无 LLM、无 DB）。
 * 运行: npx tsx scripts/test-review.ts
 */
import { applyReview } from '../app/lib/review';
import type { StageData } from '../app/models/stageData';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const sd2: StageData = {
  stage2: {
    submitted: true,
    approved: null,
    schema: { columns: [{ key: 'h', title: '株高', type: 'number', required: true }], minRows: 1, maxRows: 200 },
    aiRiskAnnotations: [{ description: 'x', severity: 'low' }],
  },
};
const sd5: StageData = {
  stage5: {
    submitted: true,
    approved: null,
    sections: { purpose: 'p', hypothesis: 'h', materials: 'm', procedure: 'pr', dataSummary: 'd', analysis: 'a', conclusion: 'c', reflection: 'r' },
  },
};

console.log('applyReview:');

// stage2 approve → currentStage 3, IN_PROGRESS, approved true
{
  const r = applyReview('approve', 2, 2, sd2, { feedback: '不错' });
  check('s2 approve → stage3', r.ok && r.currentStage === 3 && r.status === 'IN_PROGRESS');
  check('s2 approve → approved=true', r.stageData.stage2?.approved === true && r.stageData.stage2?.teacherFeedback === '不错');
}
// stage2 reject → stay 2, submitted false, data kept
{
  const r = applyReview('reject', 2, 2, sd2, { feedback: '请补充控制变量' });
  check('s2 reject → 留在 stage2', r.ok && r.currentStage === 2 && r.status === 'IN_PROGRESS');
  check('s2 reject → submitted=false approved=false', r.stageData.stage2?.submitted === false && r.stageData.stage2?.approved === false);
  check('s2 reject → 数据保留', !!r.stageData.stage2?.schema && r.stageData.stage2?.teacherFeedback === '请补充控制变量');
}
// stage5 approve → currentStage 6, score/feedback
{
  const r = applyReview('approve', 5, 5, sd5, { score: 8, feedback: '逻辑清晰' });
  check('s5 approve → stage6', r.ok && r.currentStage === 6 && r.status === 'IN_PROGRESS');
  check('s5 approve → teacherScore=8', r.stageData.stage5?.teacherScore === 8 && r.stageData.stage5?.approved === true);
}
// stage5 reject → stay 5, submitted false, sections kept
{
  const r = applyReview('reject', 5, 5, sd5, { feedback: '结论需结合数据' });
  check('s5 reject → 留在 stage5', r.ok && r.currentStage === 5);
  check('s5 reject → submitted=false 数据保留', r.stageData.stage5?.submitted === false && r.stageData.stage5?.sections.conclusion === 'c');
}
{
  const missing = applyReview('approve', 5, 5, sd5, { feedback: '未评分' });
  const invalid = applyReview('approve', 5, 5, sd5, { score: 11 });
  check('s5 approve 必须提供评分', !missing.ok && missing.error?.includes('必须填写') === true);
  check('s5 评分必须在 0–10', !invalid.ok && invalid.error?.includes('0–10') === true);
}
// s5 approve 但分数 <6 → 需重写
{
  const sd5: StageData = { stage5: { submitted: true, approved: null, sections: { purpose: '', hypothesis: '', materials: '', procedure: '', dataSummary: '', analysis: '', conclusion: 'c', reflection: 'r' } } };
  const r = applyReview('approve', 5, 5, sd5, { score: 4, feedback: '不够好' });
  check('s5 approve 低分 → 留在 stage5', r.ok && r.currentStage === 5);
  check('s5 approve 低分 → approved=false', r.stageData.stage5?.approved === false);
  check('s5 approve 低分 → submitted=false', r.stageData.stage5?.submitted === false);
  check('s5 approve 低分 → 含重写提示', r.stageData.stage5?.teacherFeedback?.includes('重新提交') === true);
}
// s5 approve 分数 >=6 → 正常推进
{
  const sd5: StageData = { stage5: { submitted: true, approved: null, sections: { purpose: '', hypothesis: '', materials: '', procedure: '', dataSummary: '', analysis: '', conclusion: 'c', reflection: 'r' } } };
  const r = applyReview('approve', 5, 5, sd5, { score: 7, feedback: '不错' });
  check('s5 approve 高分 → stage6', r.ok && r.currentStage === 6);
}
// 未提交 → error
{
  const r = applyReview('approve', 2, 2, {}, {});
  check('s2 未提交 → error', r.ok === false && !!r.error);
}

// ---- 第三阶段（可选/非阻塞/有界回滚）----
const sd3: StageData = {
  stage3: { rows: [{ day: 1 }], submitted: true, approved: null },
  stage4: { analysisCount: 3 },
};

// s3 approve → 背书，不改阶段
{
  const r = applyReview('approve', 3, 4, sd3, { feedback: '表格不错' });
  check('s3 approve → ok 且不改阶段', r.ok && r.currentStage === undefined && r.status === 'IN_PROGRESS');
  check('s3 approve → approved=true', r.stageData.stage3?.approved === true && r.stageData.stage3?.teacherFeedback === '表格不错');
  check('s3 approve → 不动 analysisCount', r.stageData.stage4?.analysisCount === 3);
}

// s3 reject 且学生在第三阶段 → 只写反馈，不推进也不锁定
{
  const r = applyReview('reject', 3, 3, sd3, { feedback: '列设计混乱' });
  check('s3 reject@3 → 不改阶段', r.ok && r.currentStage === undefined && r.status === 'IN_PROGRESS');
  check('s3 reject@3 → approved=false 且保持 submitted', r.stageData.stage3?.approved === false && r.stageData.stage3?.submitted === true);
  check('s3 reject@3 → 写反馈', r.stageData.stage3?.teacherFeedback === '列设计混乱');
}

// s3 reject 且学生已在第四阶段 → 仍不回退，不清零分析
{
  const r = applyReview('reject', 3, 4, sd3, { feedback: '重做' });
  check('s3 reject@4 → 不回退 stage3', r.ok && r.currentStage === undefined);
  check('s3 reject@4 → analysisCount 保留', r.stageData.stage4?.analysisCount === 3);
}

// s3 reject 且学生已在第五阶段 → 拒绝
{
  const r = applyReview('reject', 3, 5, sd3, { feedback: 'x' });
  check('s3 reject@5 → 拒绝', r.ok === false && !!r.error);
}

// s3 未提交 → error
{
  const r = applyReview('approve', 3, 4, {}, {});
  check('s3 未提交 → error', r.ok === false && !!r.error);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);

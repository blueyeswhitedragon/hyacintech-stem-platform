#!/usr/bin/env tsx
import './load-script-env';
import { db } from '../app/lib/db';
import type { SessionUser } from '../app/lib/session';
import { checkTutorCandidate } from '../app/lib/dataLab/bootstrap/contracts';
import { claimTutorReviewTask, submitEditReview } from '../app/lib/dataLab/bootstrap/service';
import type { TutorLanguageResponse } from '../app/lib/tutorLanguage';

type Decision = 'SELECT_A' | 'SELECT_B' | 'EDIT';
interface ReviewPlan {
  decision: Decision;
  selected: 'A' | 'B';
  rejected?: 'A' | 'B';
  final?: TutorLanguageResponse;
  reason: string;
  preferenceReason?: string;
}

const DISCLOSURE = 'AI_ASSISTED_DRAFT：由 Codex 在管理员授权下完成 Calibration 12 首次审核，必须经过独立 reviewer 实质确认。';

const PLANS: Record<string, ReviewPlan> = {
  '1:高概念代理': {
    decision: 'SELECT_A', selected: 'A', rejected: 'B',
    reason: 'A 没有给观察指标菜单，只要求学生自己说明想观察的变化；B 带模板化肯定、额外示例和两个问句。',
    preferenceReason: 'A 保留学生选择权且只推进一次聚焦；B 主动提供叶片数量指标并增加确认问题。',
  },
  '1:方向确认': {
    decision: 'SELECT_B', selected: 'B', rejected: 'A',
    reason: 'B 只完成方向核对并及时收敛；A 在确认后继续要求选择折叠形状，越过本轮 direction_confirmation。',
    preferenceReason: 'B 准确确认现有方向；A 把确认回合扩展成新的方案选择。',
  },
  '1:模糊输入': {
    decision: 'SELECT_B', selected: 'B', rejected: 'A',
    reason: 'B 直接澄清叶子状态的具体差异，语言简洁且没有预设指标；A 有不必要的评价和流程说明。',
    preferenceReason: 'B 用一个自然问题处理当前缺口；A 的铺垫更长且带模板化评价。',
  },
  '1:主题误解': {
    decision: 'SELECT_A', selected: 'A',
    reason: 'A 正面解释为什么必须先说清改变了什么，再把判断交还学生；虽然稍长，但仍围绕一个研究问题任务。',
  },
  '2:控制变量混乱': {
    decision: 'SELECT_B', selected: 'B', rejected: 'A',
    reason: 'B 清楚纠正同时改变多个条件的误解，并只追问需要固定的条件；A 连续提出两个独立问句。',
    preferenceReason: 'B 用解释加一个追问完成控制变量澄清；A 的双问题增加了本轮负担。',
  },
  '2:测量方式含糊': {
    decision: 'EDIT', selected: 'A', rejected: 'B',
    final: { dialogue: '“效果好不好”还不能让别人重复判断。你打算用什么具体方式记录溶解快慢，让每次结果都能直接比较？', interactionType: 'clarification', focus: 'measurement', hints: [] },
    reason: '保留 A 对可重复性的提醒，合并为一个明确问题；删除连续追问。B 虽只给一个例子，但仍形成两次确认。',
    preferenceReason: '最终稿只要求学生提出一种可重复测量方式；B 先提供具体指标再让学生确认，主体性较弱。',
  },
  '2:一次给全': {
    decision: 'SELECT_B', selected: 'B',
    reason: 'B 精确识别现有方案唯一明显缺口——承重记录方式，并用一个问题推进；A 也可用但更长。',
  },
  '2:安全异常': {
    decision: 'SELECT_B', selected: 'B', rejected: 'A',
    reason: 'B 先给必要的停止操作与安全原则，再让学生识别具体异常；A 提供了两个预设异常选项。',
    preferenceReason: 'B 先建立通用安全边界且保留开放回答；A 的二选一示例压缩了学生自行识别风险的空间。',
  },
  '4:因果过度': {
    decision: 'SELECT_B', selected: 'B', rejected: 'A',
    reason: 'B 准确区分关联和直接因果，并只追问控制条件；A 同时引入异常数据并连续提出多个判断。',
    preferenceReason: 'B 聚焦因果成立所需的控制条件；A 把因果、异常和多个问题并在同一回合。',
  },
  '4:异常数据': {
    decision: 'EDIT', selected: 'A', rejected: 'B',
    final: { dialogue: '先别直接删。比较第二次重复中第三组的 6 和另外两次的 7、7，看看这次延迟对应的数据是否明显偏离。', interactionType: 'clarification', focus: 'interpret_evidence', hints: [] },
    reason: '保留 A 对真实数值的引用，将两个问句合并为一个可执行的证据比较；避免 B 直接要求在保留和删除之间二选一。',
    preferenceReason: '最终稿先比较异常记录与其余重复数据，再判断影响；B 直接让学生在保留或删除之间选择，分析支架不足。',
  },
  '4:未引用数值': {
    decision: 'SELECT_B', selected: 'B', rejected: 'A',
    reason: 'B 要求学生自己任选一行引用并比较真实数值；A 直接给出条件一的完整三次数值，支架过强。',
    preferenceReason: 'B 保留学生从表中检索证据的任务；A 代替学生提供了一半的数值证据。',
  },
  '4:误读趋势': {
    decision: 'SELECT_B', selected: 'B', rejected: 'A',
    reason: 'B 用真实数值指出“最高”和“稳定”不是同一判断，并要求学生澄清术语；A 提供二选一式判断菜单且没有纠正最高值误读。',
    preferenceReason: 'B 直接基于数据纠正概念混淆；A 只让学生在两个解释之间选择，未回应条件二并非最高。',
  },
};

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runId = arg('--run-id');
  const username = arg('--admin') ?? 'data-admin';
  if (!runId) throw new Error('需要 --run-id');
  const adminRow = await db.user.findFirst({ where: { username, role: 'admin', isActive: true } });
  if (!adminRow) throw new Error(`找不到管理员：${username}`);
  const user: SessionUser = { id: adminRow.id, username: adminRow.username, displayName: adminRow.displayName, role: 'admin' };
  const submitted: Array<{ caseId: string; key: string; decision: Decision; status: string }> = [];

  for (let index = 0; index < 12; index += 1) {
    const payload = await claimTutorReviewTask('EDIT', user);
    if (!payload) throw new Error(`只领取到 ${index} 条首次审核任务`);
    const caseRow = await db.tutorTurnCase.findUniqueOrThrow({ where: { id: payload.case.id } });
    const challenge = (JSON.parse(caseRow.privateReviewSpecJson) as { challenge?: string }).challenge ?? '';
    const key = `${caseRow.phase}:${challenge}`;
    if (caseRow.generationRunId !== runId) throw new Error(`领取到其他 run 的任务：${caseRow.generationRunId}`);
    const plan = PLANS[key];
    if (!plan) throw new Error(`缺少审核计划：${key}`);
    const selected = payload.candidates.find((item) => item.slot === plan.selected);
    const rejected = plan.rejected ? payload.candidates.find((item) => item.slot === plan.rejected) : undefined;
    if (!selected) throw new Error(`${key} 缺少候选 ${plan.selected}`);
    const final = plan.final ?? JSON.parse(selected.normalizedOutput) as TutorLanguageResponse;
    const facts = payload.case.visibleFacts as { allowedFocusIds?: string[] };
    const check = checkTutorCandidate({
      rawOutput: JSON.stringify(final),
      allowedFocusIds: facts.allowedFocusIds ?? [],
      phase: payload.case.phase,
      triggerType: payload.case.triggerType,
      studentMessage: payload.case.studentMessage,
    });
    if (!check.check.ok) throw new Error(`${key} 最终草稿存在硬错误：${check.check.issues.map((item) => item.code).join('、')}`);
    const result = await submitEditReview({
      taskId: payload.task.id,
      decision: plan.decision,
      selectedCandidateId: selected.id,
      finalOutput: JSON.stringify(final),
      reason: `${DISCLOSURE}\n${plan.reason}`,
      preferenceRejectedCandidateId: rejected?.id,
      preferenceReason: rejected ? plan.preferenceReason : undefined,
      user,
    });
    submitted.push({ caseId: caseRow.id, key, decision: plan.decision, status: result.status });
    console.log(`[${index + 1}/12] ${key} ${plan.decision} → ${result.status}`);
  }

  console.log(JSON.stringify({ runId, submitted }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });

#!/usr/bin/env tsx
import './load-script-env';
import { db } from '../app/lib/db';
import type { SessionUser } from '../app/lib/session';
import { checkTutorCandidate } from '../app/lib/dataLab/bootstrap/contracts';
import { claimTutorReviewTask, submitEditReview } from '../app/lib/dataLab/bootstrap/service';
import type { TutorLanguageResponse } from '../app/lib/tutorLanguage';

type Decision = 'SELECT_A' | 'SELECT_B' | 'EDIT';
type Slot = 'A' | 'B';

interface ReviewPlan {
  index: number;
  selected: Slot;
  decision?: Decision;
  final?: TutorLanguageResponse;
  reason: string;
  preference?: boolean;
  preferenceReason?: string;
}

const DEFAULT_RUN_ID = 'bcb4a69a-a054-487a-9a44-3bf93e80762f';
const DISCLOSURE = 'AI_ASSISTED_DRAFT：由 Codex 在管理员授权下完成 Trial 36 首次审核，必须经过独立 reviewer 实质确认。';

const PLANS: Record<string, ReviewPlan> = {
  '3f49ee30-8d50-42c8-a5a4-bf9ae6113583': {
    index: 1, selected: 'A', preference: true,
    reason: 'A 直接要求学生从宽泛的“哪些因素”中选定一个条件，符合本轮聚焦研究问题的任务；B 转而追问植物种类和已观察变化，可能偏离学生当前提出的变量范围。',
    preferenceReason: 'A 更直接地收窄待研究条件；B 同时引入植物对象与变化表现，聚焦路径较间接。',
  },
  '24541505-3125-49b2-ad05-17b6f0f97831': {
    index: 2, selected: 'B', preference: true,
    reason: 'B 按学生要求只确认“桥面层数与承重”的方向，没有继续追加变量核对；A 的追问在 direction_confirmation 回合中增加了不必要的确认负担。',
    preferenceReason: 'B 准确完成方向确认并及时收敛；A 在已明确的变量关系上重复提问。',
  },
  '1dec9e24-7094-4d7b-94af-c2e0766fd7d9': {
    index: 3, selected: 'B', preference: true,
    reason: 'B 先解释为什么不能只比较“最好”，再用一个问题让学生识别可能改变的因素；A 连续两个问号，虽然相关，但本轮负担更高。',
    preferenceReason: 'B 用单一开放问题完成概念纠正和聚焦；A 的两个连续问题表达更冗长。',
  },
  'ceda6813-579d-4cc3-a5b2-4180a011a49f': {
    index: 4, selected: 'A', preference: true,
    reason: 'A 要求学生自行提出课堂时间内可观察、可记录的植物变化，没有直接给出指标菜单；B 主动提示叶片颜色并形成两次提问。',
    preferenceReason: 'A 保留学生选择观察指标的空间；B 给出具体候选答案，支架略强。',
  },
  'eb8e11b0-dda0-4fb0-b348-5f5e70a1454e': {
    index: 5, selected: 'A', preference: true,
    reason: 'A 认可光照时长方向后，只要求把“幼苗表现”缩成一个具体变化；B 额外提供叶片颜色示例，且出现两个问号。',
    preferenceReason: 'A 聚焦清楚且不预设观察指标；B 的示例可能压缩学生自主选择。',
  },
  '587d8d32-55ba-42e2-8861-8ae51f06b967': {
    index: 6, selected: 'A', decision: 'EDIT', preference: true,
    final: { dialogue: '“比较通风方式与可观察状态”可以作为研究方向，后续再分别明确通风条件和观察指标。', interactionType: 'checkpoint', focus: 'direction_confirmation', hints: [] },
    reason: '两份候选都在确认方向后继续追问细节。最终稿保留方向确认，并明确细化工作留到后续回合，避免本轮同时要求通风条件和观察指标。',
    preferenceReason: '最终稿以 A 的方向确认语义为基础并删除追加追问；B 同时要求学生回答两个尚待细化的部分。',
  },
  'f56aa1c4-24a1-49a4-bc37-f7e94e5e38d6': {
    index: 7, selected: 'A', decision: 'EDIT', preference: true,
    final: { dialogue: '你说的“最稳”具体想用什么可观察结果来判断？', interactionType: 'open_question', focus: 'research_question', hints: [] },
    reason: 'A 抓住“稳”的含义，但给出了多个候选判断；B 同时追问既有形状和计划比较的形状。最终稿只让学生定义一个可观察结果。',
    preferenceReason: '最终稿保留 A 对“稳”的核心澄清并移除答案菜单；B 一次要求回顾现状和设计比较对象。',
  },
  'cf3c1892-aff4-4269-9dfe-54acc4973660': {
    index: 8, selected: 'B', preference: true,
    reason: '学生明确要求直接确认方向，B 只核对“机翼形状影响飞行距离”的含义；A 把回合转成飞行距离与直线性的二选一，越过了 direction_confirmation 的边界。',
    preferenceReason: 'B 遵循学生的确认请求；A 重新打开结果变量选择。',
  },
  'dc252f08-ec0d-4e03-aa58-0ce34a7285a1': {
    index: 9, selected: 'B',
    reason: 'B 简洁说明必须先明确改变的条件，再让学生提出可能影响溶解快慢的因素。A 也可接受，但铺垫更长；两者差异不足以形成高置信 preference。',
  },
  'fe4277ea-4c07-486d-9f9b-a08af072540d': {
    index: 10, selected: 'A', preference: true,
    reason: 'A 接受人工光照方向后，开放询问学生想观察的植物变化；B 先替学生限定到每日光照时长，提前指定了自变量特征。',
    preferenceReason: 'A 只推进观察结果聚焦；B 在学生尚未选择时主动规定光照特征。',
  },
  'd785bbca-3912-4ee1-8102-79262f911c32': {
    index: 11, selected: 'B', preference: true,
    reason: 'B 直接追问“可观察状态”的具体含义，针对当前缺口且没有给答案菜单；A 主要展开通风方式示例，偏离本轮最需要澄清的结果变量。',
    preferenceReason: 'B 聚焦可观察结果；A 提供了通风条件候选并扩大了任务。',
  },
  'bc0949ad-6924-4a3c-b36e-f1824c1d9d5b': {
    index: 12, selected: 'B', preference: true,
    reason: 'B 明确确认不同折叠截面与承重的研究方向，并让流程进入实验方案；A 在已清楚的方向上继续要求列举具体形状。',
    preferenceReason: 'B 完成方向确认后收敛；A 把确认回合延伸为条件设计。',
  },
  '43868a28-47b3-4dab-991d-85107906cec3': {
    index: 13, selected: 'B', decision: 'EDIT', preference: true,
    final: { dialogue: '“机翼形状”还比较宽。你准备只改变其中哪一个具体特征？', interactionType: 'clarification', focus: 'independent_variable', hints: [] },
    reason: '两份候选都识别到“机翼形状”仍需具体化，但都提供了具体特征示例。最终稿保留 B 的单一问题结构并删除翼展示例，避免替学生决定变量。',
    preferenceReason: '最终稿比 A 的多项特征菜单更克制，只要求学生自行选定一个具体特征。',
  },
  '3be38a2d-7cb2-4750-ac04-1d0e8222a7f8': {
    index: 14, selected: 'B', preference: true,
    reason: 'B 直接要求建立一致的“溶解完成”判据，准确补上测量定义缺口；A 增加了示例和两个连续问句。',
    preferenceReason: 'B 用一个问题核对测量终点；A 的解释与示例增加了不必要支架。',
  },
  'b034f1c5-e019-421f-8217-866b55fb032c': {
    index: 15, selected: 'B', preference: true,
    reason: 'B 清楚解释同时改变多个条件会破坏归因，并只追问应保持不变的条件；A 连续提出归因问题和控制变量问题。',
    preferenceReason: 'B 把解释和后续任务收束到一个问题；A 的双问题提高了回合负担。',
  },
  '7477bae3-41aa-4d81-87cc-880810112eab': {
    index: 16, selected: 'B', preference: true,
    reason: 'B 的两个问号属于同一个任务：给出每种条件的重复次数并说明理由；该表面 warning 有效但不严重，最终稿可以保留且 warning 不应出现在最终文本中。',
    preferenceReason: 'B 直接要求重复次数及理由；A 用忘浇水的具体情境引导并间接暗示答案方向。',
  },
  'd4ea60d4-c970-4325-aedf-75d9285f2747': {
    index: 17, selected: 'B', preference: true,
    reason: 'B 先给出材料破损或异常时停止操作的必要安全边界，再让学生补充注意事项；A 只要求描述异常，没有先建立最低安全处置。',
    preferenceReason: 'B 同时满足安全底线与学生参与；A 缺少立即停止操作的明确要求。',
  },
  '3fcce765-3bbf-4921-a08a-edb9d258c326': {
    index: 18, selected: 'A', preference: true,
    reason: 'A 说明主观的“好不好”不可重复，并让学生自行提出偏转程度的记录方式；B 直接给出落地点偏离距离这一测量方案。',
    preferenceReason: 'A 保留学生设计测量方法的任务；B 提供了可直接照抄的具体指标。',
  },
  '57fed4d4-3ead-4cea-ae23-8f899199351c': {
    index: 19, selected: 'A', preference: true,
    reason: 'A 从学生已有方向中引出需要主动改变的具体条件，没有直接报出答案；B 明示可能改变水温，支架强度偏高。',
    preferenceReason: 'A 要求学生自己确认自变量；B 基本替学生给出了自变量。',
  },
  'd05bc370-d63a-4d09-919a-4c14a8efa283': {
    index: 20, selected: 'B',
    reason: 'B 用最短路径追问幼苗表现的观察或测量方式，准确补齐方案中的测量缺口。A 同样正确但更长，差异主要是简洁度，因此不强制导出 preference。',
  },
  'b48d50b0-5395-4c1d-a151-4f82f1c67232': {
    index: 21, selected: 'B', decision: 'EDIT', preference: true,
    final: { dialogue: '如果同时改变材料数量和记录时间，就无法判断差异来自哪个因素。除了你真正想研究的条件，其他条件应该怎样处理？', interactionType: 'clarification', focus: 'controls', hints: [] },
    reason: 'B 已指出多变量同时变化会破坏归因，但“先保持哪两个条件”略显限定。最终稿改为让学生概括除目标条件外其他条件的处理原则。',
    preferenceReason: '最终稿保留 B 的因果解释并提升为通用控制原则；A 带多个原因选项且追问的是目标变量，不是控制方式。',
  },
  '3b3bff9a-d1c6-452a-b9bd-d82cb56124a6': {
    index: 22, selected: 'B', preference: true,
    reason: 'B 的两个问号共同要求学生给出重复次数及其理由，属于同一决策链而非两个独立任务；warning 存在但不严重，也不会进入最终结果文本。',
    preferenceReason: 'B 直接获取次数和依据；A 先设置“一次是否可靠”的引导问题，结构更绕。',
  },
  '9d1f55d7-786f-43c5-b865-875bdd6d3250': {
    index: 23, selected: 'B', decision: 'EDIT', preference: true,
    final: { dialogue: '如果材料破损或飞行出现异常，先停止操作并告知老师。你最担心出现哪一种具体情况？', interactionType: 'clarification', focus: 'safety', hints: [] },
    reason: 'B 包含必要的停止操作要求，但只写更换材料且未覆盖飞行异常。最终稿补充告知老师，并保留一个开放问题让学生识别具体风险。',
    preferenceReason: '最终稿建立完整的最低安全边界；A 只提供纸飞机折坏或异常轨迹菜单，没有先说明处置原则。',
  },
  '475ac12b-eb4d-4ef3-ae9a-3be115d5a7ed': {
    index: 24, selected: 'A', preference: true,
    reason: 'A 的前一个问号是说明可重复判断必要性的反问，后一个才是实际测量任务，两者围绕同一目标；warning 有效但不严重。B 直接提示“计时直到固体完全消失”，答案代理更强。',
    preferenceReason: 'A 促使学生自行提出可比的记录方式；B 给出了具体终点判据并形成答案菜单。',
  },
  'fe782eb4-4daf-404b-b159-26e1f6c32efd': {
    index: 25, selected: 'A', preference: true,
    reason: 'A 要求从条件一和条件三中取具体数值做直接比较，能形成支持“条件三更高”的证据；B 只让学生列条件三并找最高值，缺少组间对照。',
    preferenceReason: 'A 建立支持结论所需的两组证据；B 只检索单组数据，不能充分支撑比较判断。',
  },
  '0ab371b8-21fa-433e-b2b7-ea0f482ef0c0': {
    index: 26, selected: 'A', decision: 'EDIT', preference: true,
    final: { dialogue: '先别直接定结论。条件三的数值较高只是观察结果，还要检查三次重复是否一致，以及异常记录会不会改变整体判断。', interactionType: 'explanation', focus: 'interpret_evidence', hints: [] },
    reason: 'A 引用了条件三数据和异常记录，但连续追问因果与异常影响。最终稿把任务收束为结论前的两项证据检查，不直接要求学生立即完成多个回答。',
    preferenceReason: '最终稿明确区分观察和结论，并同时保留重复一致性与异常影响；B 只用泛化反问提醒，证据检查不够具体。',
  },
  '6b0966b3-da4e-40af-a0ad-8201f380894d': {
    index: 27, selected: 'A', preference: true,
    reason: 'A 先承认条件二较稳定，再让学生自行从三组数据中判断哪组数值最高；B 直接给出条件三更高的答案，减少了学生读表任务。',
    preferenceReason: 'A 纠正“稳定”等于“最高”的混淆但仍保留数据检索；B 代替学生完成关键比较。',
  },
  '82cc0cf4-0548-4a22-bb6e-a3bc5038e706': {
    index: 28, selected: 'A', decision: 'EDIT', preference: true,
    final: { dialogue: '先保留异常备注，把这次的 6 与另外两次的 7、7 放在一起比较，再判断操作延迟是否明显改变了整体趋势。', interactionType: 'clarification', focus: 'interpret_evidence', hints: [] },
    reason: 'A 使用真实数值引导比较，但两个问号要求连续判断。最终稿把异常备注、数值比较和趋势判断合并为一个可执行步骤。',
    preferenceReason: '最终稿保留 A 的具体证据支架并消除双问题；B 先推测延迟使结果偏低且展开删除后果，解释偏多。',
  },
  '830208c7-7435-4e8b-87f0-8d8193bf2841': {
    index: 29, selected: 'B',
    reason: 'B 准确区分“反复共同出现”的关联与“由该条件单独造成”的因果，并要求学生提出其他可能因素。A 也完成了同一任务，两者差异不足以形成高置信 preference。',
  },
  'c94e0619-23d4-422e-9cf4-9e994eaf00a9': {
    index: 30, selected: 'B', preference: true,
    reason: 'B 引用两组完整数据，明确当前只能说明稳定差别与关联，并指出还需检查控制变量；A 用两个问号要求学生同时作因果判断和说明理由。',
    preferenceReason: 'B 以陈述方式准确建立证据边界和下一步检查；A 的双问题认知负担更高。',
  },
  '73ef6d64-26ef-4049-adea-e9999321f741': {
    index: 31, selected: 'A', preference: true,
    reason: 'A 要求学生自己从条件一和条件三提取数值并直接比较，符合 cite_evidence；B 已替学生给出第一组对比，只让其继续找类似证据。',
    preferenceReason: 'A 保留完整的数据检索与对比任务；B 代替学生提供了一组关键数值。',
  },
  'aa182c57-f041-4d4c-bf49-3a53cd184e61': {
    index: 32, selected: 'B', preference: true,
    reason: 'B 明确“最好”和“成功”仍需重复稳定性及异常因素证据，并只让学生先选一项检查；A 一次要求列三次数值、判断一致性并解释意义。',
    preferenceReason: 'B 将多项证据检查分步推进；A 把三个子任务压在一个问句中。',
  },
  'e2bb9a27-4619-4fd7-af75-a69e65a9f6f4': {
    index: 33, selected: 'B', decision: 'EDIT', preference: true,
    final: { dialogue: '条件二的记录是 5、5、4，比较稳定；条件三是 7、6、7，数值更高。“稳定”和“最高”是两个不同判断。', interactionType: 'explanation', focus: 'interpret_evidence', hints: [] },
    reason: 'A、B 都把“稳定”和“数值高”写成二选一问题并触发答案菜单 warning。最终稿直接用完整数据区分两个概念，不把本来可同时成立的状态误写成单选。',
    preferenceReason: '最终稿沿用 B 已给出的跨组比较并补齐全部数值；A 仍要求学生在“最大”与“稳定”之间选择。',
  },
  'a225cc9e-2c8f-4430-80ac-2dc9e6374d65': {
    index: 34, selected: 'A', preference: true,
    reason: 'A 让学生先判断操作延迟可能怎样影响数值，再决定数据处理，避免直接删除；B 较长且明显把学生引向“保留更有帮助”的结论。',
    preferenceReason: 'A 要求先分析异常机制；B 对保留数据的价值给出较强倾向性提示。',
  },
  '462e9d4b-fed0-4e26-b47c-c3459b677115': {
    index: 35, selected: 'B', preference: true,
    reason: 'B 直接说明重复出现的高值仍只是关联，再让学生寻找其他影响因素；A 同时追问操作延迟和能否区分关联因果，形成两个判断任务。',
    preferenceReason: 'B 用一个开放问题推进因果边界检查；A 同时引入具体异常与概念辨析。',
  },
  'e1b9c6dc-752b-4738-b3c5-f17d91af1caf': {
    index: 36, selected: 'B', preference: true,
    reason: 'B 承认条件三每次更高只说明关联，并开放询问判断因果还需考虑什么；A 把“直接导致”与“只能关联”组织成二选一，答案菜单倾向更强。',
    preferenceReason: 'B 不预设学生必须从两个标签中选择，并把下一步放在证据条件上；A 的二选一结构更封闭。',
  },
};

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function expectedDecision(plan: ReviewPlan): Decision {
  return plan.decision ?? (plan.selected === 'A' ? 'SELECT_A' : 'SELECT_B');
}

async function preflight(runId: string) {
  const planEntries = Object.entries(PLANS);
  const indexes = planEntries.map(([, plan]) => plan.index).sort((a, b) => a - b);
  if (planEntries.length !== 36 || indexes.some((value, index) => value !== index + 1)) {
    throw new Error('审核计划必须恰好覆盖编号 1-36，且编号不得重复或缺失');
  }

  const caseIds = planEntries.map(([caseId]) => caseId);
  const cases = await db.tutorTurnCase.findMany({
    where: { id: { in: caseIds } },
    include: {
      candidates: { orderBy: { slot: 'asc' } },
      reviewTasks: true,
    },
  });
  if (cases.length !== 36) throw new Error(`数据库中只找到 ${cases.length}/36 个计划 case`);

  const otherActive = await db.tutorTurnCase.count({
    where: { status: 'IN_REVIEW', generationRunId: { not: runId } },
  });
  if (otherActive > 0) throw new Error(`另有 ${otherActive} 条其他 run 的 IN_REVIEW case，拒绝自动领取以避免串批`);

  let selectedWarnings = 0;
  let finalWarnings = 0;
  let preferences = 0;
  const editTypes: Record<string, number> = { SELECT_A: 0, SELECT_B: 0, EDIT: 0 };

  for (const caseRow of cases) {
    const plan = PLANS[caseRow.id];
    if (caseRow.generationRunId !== runId) throw new Error(`case ${plan.index} 不属于目标 run：${caseRow.generationRunId}`);
    if (!['IN_REVIEW', 'AWAITING_CONFIRMATION'].includes(caseRow.status)) {
      throw new Error(`case ${plan.index} 状态异常：${caseRow.status}`);
    }
    const editTask = caseRow.reviewTasks.find((task) => task.type === 'EDIT');
    if (!editTask || !['PENDING', 'IN_PROGRESS', 'RETURNED', 'SUBMITTED'].includes(editTask.status)) {
      throw new Error(`case ${plan.index} 首审任务状态异常：${editTask?.status ?? 'MISSING'}`);
    }
    if (caseRow.candidates.length !== 2) throw new Error(`case ${plan.index} 候选数不是 2：${caseRow.candidates.length}`);
    const selected = caseRow.candidates.find((candidate) => candidate.slot === plan.selected);
    if (!selected?.normalizedOutput) throw new Error(`case ${plan.index} 缺少候选 ${plan.selected} 标准化输出`);
    const selectedCheck = parseJson<{ hardErrorCount?: number; warningCount?: number }>(selected.deterministicCheckJson, {});
    if ((selectedCheck.hardErrorCount ?? 1) > 0) throw new Error(`case ${plan.index} 选中候选存在硬错误`);
    selectedWarnings += selectedCheck.warningCount ?? 0;

    const final = plan.final ?? parseJson<TutorLanguageResponse | null>(selected.normalizedOutput, null);
    if (!final) throw new Error(`case ${plan.index} 无法解析最终稿`);
    const facts = parseJson<{ allowedFocusIds?: string[] }>(caseRow.visibleFactsJson, {});
    const check = checkTutorCandidate({
      rawOutput: JSON.stringify(final),
      allowedFocusIds: facts.allowedFocusIds ?? [],
      phase: caseRow.phase,
      triggerType: caseRow.triggerType,
      studentMessage: caseRow.studentMessage,
    });
    if (!check.check.ok) {
      throw new Error(`case ${plan.index} 最终稿存在硬错误：${check.check.issues.filter((item) => item.severity === 'error').map((item) => item.code).join('、')}`);
    }
    finalWarnings += check.check.warningCount;
    if (plan.preference) {
      const rejected = caseRow.candidates.find((candidate) => candidate.slot !== plan.selected);
      const rejectedCheck = rejected ? parseJson<{ hardErrorCount?: number }>(rejected.deterministicCheckJson, {}) : null;
      if (!rejected?.normalizedOutput || (rejectedCheck?.hardErrorCount ?? 1) > 0 || !plan.preferenceReason?.trim()) {
        throw new Error(`case ${plan.index} preference 配置不完整或 rejected 不可用`);
      }
      preferences += 1;
    }
    editTypes[expectedDecision(plan)] += 1;
  }

  const statusCounts = cases.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
  return { statusCounts, selectedWarnings, finalWarnings, preferences, decisions: editTypes };
}

async function summarize(runId: string) {
  const cases = await db.tutorTurnCase.findMany({
    where: { generationRunId: runId },
    select: {
      status: true,
      reviewTasks: {
        select: {
          type: true,
          status: true,
          decision: true,
          preferenceRejectedCandidateId: true,
          draftJson: true,
        },
      },
    },
  });
  const caseStatuses: Record<string, number> = {};
  const taskStatuses: Record<string, number> = {};
  const decisions: Record<string, number> = {};
  const editMetrics: Record<string, number> = {};
  let preferences = 0;
  let finalHardErrors = 0;
  let finalWarnings = 0;
  let candidateWarningRefs = 0;

  for (const caseRow of cases) {
    caseStatuses[caseRow.status] = (caseStatuses[caseRow.status] ?? 0) + 1;
    for (const task of caseRow.reviewTasks) {
      const taskKey = `${task.type}/${task.status}`;
      taskStatuses[taskKey] = (taskStatuses[taskKey] ?? 0) + 1;
      if (task.type !== 'EDIT' || task.status !== 'SUBMITTED') continue;
      decisions[task.decision] = (decisions[task.decision] ?? 0) + 1;
      if (task.preferenceRejectedCandidateId) preferences += 1;
      const draft = parseJson<{
        editMetrics?: { type?: string };
        finalCheck?: { hardErrorCount?: number; warningCount?: number };
        warningIds?: string[];
      }>(task.draftJson, {});
      const metricType = draft.editMetrics?.type ?? 'UNKNOWN';
      editMetrics[metricType] = (editMetrics[metricType] ?? 0) + 1;
      finalHardErrors += draft.finalCheck?.hardErrorCount ?? 0;
      finalWarnings += draft.finalCheck?.warningCount ?? 0;
      candidateWarningRefs += draft.warningIds?.length ?? 0;
    }
  }
  return { runId, cases: cases.length, caseStatuses, taskStatuses, decisions, editMetrics, preferences, finalHardErrors, finalWarnings, candidateWarningRefs };
}

async function main() {
  const runId = arg('--run-id') ?? DEFAULT_RUN_ID;
  const username = arg('--admin') ?? 'data-admin';
  const dryRun = hasFlag('--dry-run');
  const preflightResult = await preflight(runId);
  console.log(JSON.stringify({ mode: dryRun ? 'DRY_RUN' : 'SUBMIT', runId, preflight: preflightResult }, null, 2));
  if (dryRun) return;

  const adminRow = await db.user.findFirst({ where: { username, role: 'admin', isActive: true } });
  if (!adminRow) throw new Error(`找不到有效管理员：${username}`);
  const user: SessionUser = { id: adminRow.id, username: adminRow.username, displayName: adminRow.displayName, role: 'admin' };
  const remaining = await db.tutorTurnCase.count({ where: { generationRunId: runId, status: 'IN_REVIEW', id: { in: Object.keys(PLANS) } } });

  for (let index = 0; index < remaining; index += 1) {
    const payload = await claimTutorReviewTask('EDIT', user);
    if (!payload) throw new Error(`预计还需提交 ${remaining - index} 条，但未能领取任务`);
    const plan = PLANS[payload.case.id];
    if (!plan) throw new Error(`领取到计划外 case：${payload.case.id}`);
    const caseRow = await db.tutorTurnCase.findUniqueOrThrow({ where: { id: payload.case.id } });
    if (caseRow.generationRunId !== runId) throw new Error(`领取到其他 run 的任务：${caseRow.generationRunId}`);

    const selected = payload.candidates.find((candidate) => candidate.slot === plan.selected);
    if (!selected?.normalizedOutput) throw new Error(`case ${plan.index} 缺少候选 ${plan.selected}`);
    const rejected = plan.preference ? payload.candidates.find((candidate) => candidate.slot !== plan.selected) : undefined;
    const final = plan.final ?? parseJson<TutorLanguageResponse | null>(selected.normalizedOutput, null);
    if (!final) throw new Error(`case ${plan.index} 无法解析最终稿`);

    const result = await submitEditReview({
      taskId: payload.task.id,
      decision: expectedDecision(plan),
      selectedCandidateId: selected.id,
      finalOutput: JSON.stringify(final),
      reason: `${DISCLOSURE}\n${plan.reason}`,
      preferenceRejectedCandidateId: rejected?.id,
      preferenceReason: rejected ? plan.preferenceReason : undefined,
      user,
    });
    console.log(`[${index + 1}/${remaining}] Trial #${plan.index} ${expectedDecision(plan)} ${plan.selected} → ${result.status} / ${result.editMetrics?.type ?? 'N/A'}`);
  }

  console.log(JSON.stringify(await summarize(runId), null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });

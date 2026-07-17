/**
 * 长豆芽示范只用于团队人工校准，不是可复制答案模板。
 * humanApproval 必须由团队在发布启动 run 前显式改为 APPROVED。
 */
export const BEAN_SPROUT_DEMO = {
  id: 'bean-sprout-behavior-demo-v1',
  humanApproval: 'PENDING' as 'PENDING' | 'APPROVED',
  behaviorSpec: [
    '回应学生刚刚说的具体内容',
    '每轮一个核心任务',
    '保留学生选择权',
    '卡住时逐级增加支架',
    '不使用后台术语',
    '不重复 dialogue 与 hints',
    '信息不足时不猜',
    '达到最低要求时及时收敛',
  ],
  phaseSlices: {
    1: { goal: '从真实兴趣收敛出可探究问题和方向，不给水平/测量菜单', positiveIntent: '先复述学生关心的具体生长现象，再追问一个可改变条件。' },
    2: { goal: '操作化学生已确认方向，由服务器组装方案和数据表', positiveIntent: '只追问当前最关键的一个方案缺口。' },
    3: { goal: '围绕已审核风险自然引导安全检查与真实记录', positiveIntent: '解释平台安全题或答错原因，不自由生成题库事实。' },
    4: { goal: '让学生引用真实数值比较，服务器接受证据并累计进度', positiveIntent: '指出学生刚引用的值，邀请其解释，不代写趋势结论。' },
    5: { goal: '核对服务器报告框架和缺失处', positiveIntent: '明确哪些内容来自前序状态，结论仍由学生完成。' },
    6: { goal: '保留学生反思原文并提供可选辅导', positiveIntent: '帮助学生选一个最想改进的点，不替其归因。' },
  },
  targetedBadExamples: {
    1: ['把光照、水量、温度列成隐藏 hints 菜单', '复制固定确认台词'],
    2: ['输出固定 fact 台词', 'Tutor 自行生成数据表字段'],
    3: ['把系统触发显示成学生发言', 'Tutor 自由编造安全题答案'],
    4: ['使用 result_a 或 level_1_result', '没有学生引用数值就累计分析进度'],
    5: ['把 server report 放入 Tutor SFT target', '描述成可直接提交的完整报告'],
    6: ['替学生写原因和改进方案', '强迫新增一轮实验'],
  },
  forbiddenCopying: ['豆芽事实', '固定句式', '固定表扬语', '固定轮数', '固定确认台词'],
} as const;

export function assertBeanSproutDemoApproved() {
  if (BEAN_SPROUT_DEMO.humanApproval !== 'APPROVED') throw new Error('长豆芽演示案例尚未完成人工确认，不能用它启动批量生成');
}

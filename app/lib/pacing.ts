/**
 * 纯函数：过度追问的节奏兜底判定。
 * 仅第一、第二阶段是「苏格拉底式讨论」、存在过度追问风险，故只对这两阶段设阈值。
 * 其余阶段由按钮 / 数据 gating / 教师审核推进，不在此兜底。
 */

/** 各阶段对话轮次阈值：达到即在 prompt 注入「该收敛」提示。 */
export const PACING_THRESHOLDS: Record<number, number> = {
  1: 6,
  2: 6,
};

/** 达到阈值 → 提示模型尽快收敛（输出阶段完成信号）。 */
export function shouldNudgeConvergence(stage: number, roundCount: number): boolean {
  const t = PACING_THRESHOLDS[stage];
  return t !== undefined && roundCount >= t;
}

/**
 * 是否显示「我已准备好，进入下一步」逃生按钮。
 * 仅第一阶段——它有学生侧的放行口（确认书 → 推进）；逃生按钮通过发送一条
 * 强制收敛消息促使模型立刻输出确认书，不绕过 canAdvance 的数据 gating。
 */
export function shouldShowEscapeHatch(stage: number, roundCount: number): boolean {
  return stage === 1 && shouldNudgeConvergence(stage, roundCount);
}

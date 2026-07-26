import type { Stage4Data, Stage4RoundRejection, StageData } from '@/app/models/stageData';
import { contractHash } from '@/app/lib/stageState';

export const STAGE4_REQUIRED_EVIDENCE_ROUNDS = 2;

/** 逐轮判定的学生可读说明：只说差在哪一半，不放松任何标准。 */
export const STAGE4_REJECTION_HINTS: Record<Stage4RoundRejection, string> = {
  NO_EVIDENCE: '这一轮没有引用到数据表里真实存在的数值。请直接写出表中的具体数字，只报行号或写表里没有的数不算。',
  SINGLE_EVIDENCE: '这一轮只对上了 1 个单元格。同一条消息里要同时引用两个不同的单元格。',
  NO_COMPARISON: '这一轮引用到了真实数值，但没有把它们放在一起比较。补一句「谁比谁高／低／大／小」就可以计入。',
  NO_NEW_EVIDENCE: '这一轮引用的单元格此前都已经计入过了。换一行或换一列的数据，再做一次比较。',
};

export function describeStage4LastRound(stage4?: Stage4Data): string | undefined {
  const last = stage4?.lastRound;
  if (!last) return undefined;
  if (last.accepted) return '上一轮已计入：引用了真实单元格并完成了比较。';
  return last.rejection ? STAGE4_REJECTION_HINTS[last.rejection] : undefined;
}

type EvidenceRound = NonNullable<Stage4Data['evidenceRounds']>[number];

export function evidenceRoundFingerprint(round: EvidenceRound): string {
  if (round.roundFingerprint?.trim()) return round.roundFingerprint.trim();
  const evidenceFingerprints = (round.evidence ?? [])
    .map((item) => item.fingerprint)
    .filter(Boolean)
    .sort();
  const identity = evidenceFingerprints.length > 0
    ? evidenceFingerprints
    : [
        ...(round.citations ?? []).map((item) => item.trim()).filter(Boolean),
        ...(round.matchedValues ?? []).map((item) => item.trim()).filter(Boolean),
      ].sort();
  return contractHash('stage-contract-v4/evidence-round/recovery-v1', identity);
}

export interface Stage4Readiness {
  ready: boolean;
  acceptedRoundCount: number;
  requiredRoundCount: number;
  missingRoundCount: number;
  roundFingerprints: string[];
  message: string;
}

/**
 * 只统计已被服务器接受并落库的轮次，按轮次指纹去重。
 *
 * 接受端（updateServerAnalysis）现在要求每轮至少带一个此前未计入的单元格，
 * 因此两个已接受轮次不可能共享轮次指纹——前后端进度按构造一致。
 * 这里刻意不按单元格并集重算历史：旧规则下合法接受的轮次不应被追溯降级。
 */
export function evaluateStage4Readiness(stageData: StageData): Stage4Readiness {
  const rounds = stageData.stage4?.evidenceRounds ?? [];
  const roundFingerprints = [...new Set(
    rounds
      .filter((round) => Boolean(round.roundFingerprint)
        || (round.evidence?.length ?? 0) >= 2
        || (round.citations?.length ?? 0) >= 2)
      .map(evidenceRoundFingerprint)
      .filter(Boolean),
  )];
  const modernContract = ['stage-contract-v3', 'stage-contract-v4'].includes(
    stageData.contractMeta?.stageContractVersion ?? '',
  );
  const acceptedRoundCount = rounds.length > 0 || modernContract
    ? roundFingerprints.length
    : Math.max(0, stageData.stage4?.analysisCount ?? 0);
  const missingRoundCount = Math.max(0, STAGE4_REQUIRED_EVIDENCE_ROUNDS - acceptedRoundCount);
  const ready = missingRoundCount === 0;
  return {
    ready,
    acceptedRoundCount,
    requiredRoundCount: STAGE4_REQUIRED_EVIDENCE_ROUNDS,
    missingRoundCount,
    roundFingerprints,
    message: ready
      ? '已完成两轮使用不同证据的数据分析，可以进入报告成型。'
      : `还需完成 ${missingRoundCount} 轮引用真实单元格且证据不同的数据比较。`,
  };
}

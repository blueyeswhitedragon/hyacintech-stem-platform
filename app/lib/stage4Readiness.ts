import type { Stage4Data, StageData } from '@/app/models/stageData';
import { contractHash } from '@/app/lib/stageState';

export const STAGE4_REQUIRED_EVIDENCE_ROUNDS = 2;

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

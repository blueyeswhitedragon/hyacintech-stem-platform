import { redirect } from 'next/navigation';
import ProductionCandidateManager from '@/app/components/dataLab/ProductionCandidateManager';
import { parseJson } from '@/app/lib/dataLab/validation';
import type { ShareGPTRecord } from '@/app/lib/dataLab/types';
import { listProductionCandidates } from '@/app/lib/productionCandidates';
import { getCurrentUser } from '@/app/lib/session';

export default async function CandidatesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const candidates = await listProductionCandidates();
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">线上问题候选池</h1><p className="mt-1 text-sm text-gray-500">仅显示本机确定性脱敏快照；通过仍不等于训练资格，必须继续完成人工纠正和复核。</p></div>
      <ProductionCandidateManager candidates={candidates.map((candidate) => {
        const record = parseJson<ShareGPTRecord>(candidate.redactedRecordJson, {} as ShareGPTRecord);
        const report = parseJson<{ replacements?: Record<string, number> }>(candidate.redactionReportJson, {});
        const leakage = parseJson<{ exactMatches?: string[]; nearDuplicates?: unknown[] }>(candidate.leakageCheckJson, {});
        const human = record.conversations?.find((message) => message.from === 'human')?.value ?? '';
        const rawAssistant = record.conversations?.find((message) => message.from === 'gpt')?.value ?? '{}';
        let assistant = rawAssistant;
        try { assistant = (JSON.parse(rawAssistant) as { dialogue?: string }).dialogue ?? rawAssistant; } catch { assistant = rawAssistant; }
        return { id: candidate.id, status: candidate.status, stage: candidate.generationTrace.stage, styleFamily: candidate.generationTrace.styleFamily, modelTag: candidate.generationTrace.modelVersion.tag, triggerNote: candidate.triggerNote, human, assistant, replacements: Object.values(report.replacements ?? {}).reduce((sum, value) => sum + value, 0), exactMatches: leakage.exactMatches?.length ?? 0, nearDuplicates: leakage.nearDuplicates?.length ?? 0 };
      })} />
    </div>
  );
}

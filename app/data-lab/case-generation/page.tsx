import { redirect } from 'next/navigation';
import CaseGenerationManager from '@/app/components/dataLab/CaseGenerationManager';
import { approvedTopicCardCoverage, calibrationQualityReport, listTutorCases, smokeQualityReport, trialQualityReport } from '@/app/lib/dataLab/bootstrap/service';
import { getCurrentUser } from '@/app/lib/session';

export default async function CaseGenerationPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/data-lab');
  const [cases, smoke, calibration, trial, topicCoverage] = await Promise.all([
    listTutorCases(),
    smokeQualityReport(),
    calibrationQualityReport(),
    trialQualityReport(),
    approvedTopicCardCoverage(),
  ]);
  const defaultModels = {
    A: {
      provider: process.env.DATA_LAB_MODEL_A_PROVIDER ?? 'openai',
      model: process.env.DATA_LAB_MODEL_A ?? 'Qwen3.5-35B-A3B',
    },
    B: {
      provider: process.env.DATA_LAB_MODEL_B_PROVIDER ?? 'deepseek',
      model: process.env.DATA_LAB_MODEL_B ?? 'deepseek-v4-pro',
    },
  };
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">案例批次</h1>
        <p className="mt-1 text-sm text-gray-500">从 6 条冒烟验证开始逐级扩产；每一级完成双审并通过质量门禁后，下一层才会解锁。</p>
      </div>
      <CaseGenerationManager cases={cases} smoke={smoke} calibration={calibration} trial={trial} topicCoverage={topicCoverage} defaultModels={defaultModels} />
    </div>
  );
}

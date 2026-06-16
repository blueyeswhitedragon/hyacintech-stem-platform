"use client";

import React, { useState } from 'react';
import type { Stage5Data, Stage6Data } from '@/app/models/stageData';

interface Props {
  stage5?: Stage5Data;
  stage6?: Stage6Data;
  completed: boolean;
  onSubmit: (response: string) => Promise<string | null>;
  /** 体验模式：无教师评分，改为展示 AI 参考评分自评。 */
  guestMode?: boolean;
}

export default function Stage6Panel({ stage5, stage6, completed, onSubmit, guestMode }: Props) {
  const [response, setResponse] = useState(stage6?.studentResponse ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    setBusy(true); setErr(null);
    const e = await onSubmit(response);
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-medium">结果反思</h3>

      {guestMode ? (
        stage5?.aiReferenceScore ? (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
            <div className="font-medium text-blue-800 mb-1">
              AI 参考评分（体验模式自评）：{stage5.aiReferenceScore.overall} / 10
            </div>
            <div className="text-gray-700">
              完整 {stage5.aiReferenceScore.dimensions.completeness} · 逻辑 {stage5.aiReferenceScore.dimensions.logic} · 数据 {stage5.aiReferenceScore.dimensions.dataUsage} · 创新 {stage5.aiReferenceScore.dimensions.innovation} · 表达 {stage5.aiReferenceScore.dimensions.expression}
            </div>
            {stage5.aiReferenceScore.highlights.length > 0 && (
              <div className="mt-1 text-gray-700">亮点：{stage5.aiReferenceScore.highlights.join('；')}</div>
            )}
            {stage5.aiReferenceScore.suggestions.length > 0 && (
              <div className="mt-1 text-gray-700">
                建议：{stage5.aiReferenceScore.suggestions.map((s) => `[${s.targetSection}] ${s.text}`).join('；')}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-500">体验模式无教师评分。</div>
        )
      ) : (
        stage5 && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
            <div className="font-medium text-blue-800 mb-1">教师评价</div>
            {typeof stage5.teacherScore === 'number' && (
              <div className="text-gray-800">评分：<span className="font-semibold">{stage5.teacherScore}</span> / 10</div>
            )}
            {stage5.teacherFeedback && <div className="text-gray-700 mt-1 whitespace-pre-wrap">{stage5.teacherFeedback}</div>}
            {!stage5.teacherFeedback && typeof stage5.teacherScore !== 'number' && (
              <div className="text-gray-500">教师暂未留下评语。</div>
            )}
          </div>
        )
      )}

      {completed ? (
        <div className="space-y-2">
          <div className="text-green-700 font-medium">✅ 探究已完成</div>
          <div className="text-sm text-gray-600">你的反思：</div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded p-2">
            {stage6?.studentResponse}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-sm font-medium text-blue-700 mb-1">你的反思与回应</div>
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            rows={5}
            className="w-full border rounded p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="结合教师评价，谈谈你的收获、不足，以及下一步可以怎样深入研究……"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleSubmit}
              disabled={busy || response.trim() === ''}
              className="px-4 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            >
              {busy ? '提交中…' : '提交反思，完成探究'}
            </button>
            {err && <span className="text-sm text-red-600">{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

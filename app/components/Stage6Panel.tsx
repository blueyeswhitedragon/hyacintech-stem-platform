"use client";

import React, { useState } from 'react';
import type { Stage5Data, Stage6Data, Stage2Column } from '@/app/models/stageData';
import ReportDocument from './ReportDocument';

interface Props {
  stage5?: Stage5Data;
  stage6?: Stage6Data;
  completed: boolean;
  onSubmit: (responseToTeacherFeedback: string, learningReflection: string) => Promise<string | null>;
  guestMode?: boolean;
  /** 阶段2列定义 + 阶段3数据，用于在反思阶段继续展示完整报告与数据表。 */
  schemaColumns?: Stage2Column[];
  dataRows?: Record<string, unknown>[];
}

export default function Stage6Panel({ stage5, stage6, completed, onSubmit, guestMode, schemaColumns, dataRows }: Props) {
  const [feedbackResponse, setFeedbackResponse] = useState(
    stage6?.responseToTeacherFeedback ?? stage6?.studentResponse ?? '',
  );
  const [learningReflection, setLearningReflection] = useState(
    stage6?.learningReflection ?? stage6?.studentResponse ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    setBusy(true); setErr(null);
    const e = await onSubmit(feedbackResponse, learningReflection);
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <div className="p-4 space-y-4">
      {/* 完整报告 + 数据表在反思阶段继续可见（只读），消除「进入下一阶段后表格消失」的观感 */}
      {stage5?.sections && (
        <details className="border rounded" open>
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50">
            📄 实验报告（含数据表）
          </summary>
          <div className="p-3">
            <ReportDocument
              stage5={stage5}
              schemaColumns={schemaColumns}
              dataRows={dataRows}
              showStudentFields={true}
            />
          </div>
        </details>
      )}

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
          <div className="text-sm text-gray-600">你对教师评价的回应：</div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded p-2">
            {stage6?.responseToTeacherFeedback ?? stage6?.studentResponse}
          </div>
          <div className="text-sm text-gray-600">你的学习反思：</div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded p-2">
            {stage6?.learningReflection ?? stage6?.studentResponse}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-sm font-medium text-blue-700 mb-1">回应教师评价</div>
          <textarea
            value={feedbackResponse}
            onChange={(e) => setFeedbackResponse(e.target.value)}
            rows={4}
            className="w-full border rounded p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="你怎样理解教师的评分和反馈？准备保留或改进什么？"
          />
          <div className="text-sm font-medium text-blue-700 mb-1 mt-3">学习反思</div>
          <textarea
            value={learningReflection}
            onChange={(e) => setLearningReflection(e.target.value)}
            rows={4}
            className="w-full border rounded p-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="这次探究中你学会了什么？下次会怎样开展探究？"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={handleSubmit}
              disabled={busy || feedbackResponse.trim() === '' || learningReflection.trim() === ''}
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

"use client";

import React, { useState } from 'react';
import type { Stage5Data, Stage6Data, Stage2Column } from '@/app/models/stageData';
import ReportDocument from './ReportDocument';
import Button from './ui/Button';
import Callout from './ui/Callout';
import Card from './ui/Card';
import { Field, Textarea } from './ui/Field';

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
    <div className="space-y-5 p-4">
      <h3 className="display-sm">结果反思</h3>

      {guestMode ? (
        stage5?.aiReferenceScore ? (
          <Card tone="soft" className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="caption-upper">AI 参考评分（体验模式自评）</span>
              <span className="font-lineage text-lg text-ink">{stage5.aiReferenceScore.overall} / 10</span>
            </div>
            <div className="mt-2 leading-6 text-body">
              完整 {stage5.aiReferenceScore.dimensions.completeness} · 逻辑 {stage5.aiReferenceScore.dimensions.logic} · 数据 {stage5.aiReferenceScore.dimensions.dataUsage} · 创新 {stage5.aiReferenceScore.dimensions.innovation} · 表达 {stage5.aiReferenceScore.dimensions.expression}
            </div>
            {stage5.aiReferenceScore.highlights.length > 0 && (
              <div className="mt-1 leading-6 text-body">亮点：{stage5.aiReferenceScore.highlights.join('；')}</div>
            )}
            {stage5.aiReferenceScore.suggestions.length > 0 && (
              <div className="mt-1 leading-6 text-body">
                建议：{stage5.aiReferenceScore.suggestions.map((s) => `[${s.targetSection}] ${s.text}`).join('；')}
              </div>
            )}
          </Card>
        ) : (
          <p className="text-sm text-muted">体验模式无教师评分。</p>
        )
      ) : (
        stage5 && (
          <Card tone="soft" className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="caption-upper">教师评价</span>
              {typeof stage5.teacherScore === 'number' && (
                <span className="font-lineage text-lg text-ink">{stage5.teacherScore} / 10</span>
              )}
            </div>
            {stage5.teacherFeedback && <div className="mt-2 whitespace-pre-wrap leading-6 text-body">{stage5.teacherFeedback}</div>}
            {!stage5.teacherFeedback && typeof stage5.teacherScore !== 'number' && (
              <div className="mt-2 text-muted">教师暂未留下评语。</div>
            )}
          </Card>
        )
      )}

      {completed ? (
        <div className="space-y-3">
          <Callout tone="success">探究已完成。</Callout>
          <div>
            <div className="caption-upper mb-1.5">你对教师评价的回应</div>
            <div className="whitespace-pre-wrap rounded-md border border-hairline bg-surface-soft p-3 text-sm leading-6 text-body">
              {stage6?.responseToTeacherFeedback ?? stage6?.studentResponse}
            </div>
          </div>
          <div>
            <div className="caption-upper mb-1.5">你的学习反思</div>
            <div className="whitespace-pre-wrap rounded-md border border-hairline bg-surface-soft p-3 text-sm leading-6 text-body">
              {stage6?.learningReflection ?? stage6?.studentResponse}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="回应教师评价" htmlFor="stage6-feedback">
            <Textarea
              id="stage6-feedback"
              value={feedbackResponse}
              onChange={(e) => setFeedbackResponse(e.target.value)}
              rows={4}
              placeholder="你怎样理解教师的评分和反馈？准备保留或改进什么？"
            />
          </Field>
          <Field label="学习反思" htmlFor="stage6-reflection">
            <Textarea
              id="stage6-reflection"
              value={learningReflection}
              onChange={(e) => setLearningReflection(e.target.value)}
              rows={4}
              placeholder="这次探究中你学会了什么？下次会怎样开展探究？"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={busy || feedbackResponse.trim() === '' || learningReflection.trim() === ''}
            >
              {busy ? '提交中…' : '提交反思，完成探究'}
            </Button>
            {err && <span className="text-sm text-error">{err}</span>}
          </div>
        </div>
      )}

      {/* 报告仍可查阅，但默认折叠，避免把教师反馈和反思表单推到长文档之后。 */}
      {stage5?.sections && (
        <details className="rounded-lg border border-hairline">
          <summary className="cursor-pointer select-none rounded-lg bg-surface-soft px-3 py-2.5 text-sm font-medium text-body-strong">
            查看完整实验报告（含数据表与图表）
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
    </div>
  );
}

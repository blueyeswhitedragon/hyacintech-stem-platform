"use client";

import React from 'react';
import type { Stage5Data, Stage2Column } from '@/app/models/stageData';
import { limitationsDiscussion } from '@/app/lib/reportFields';
import DataChart from './DataChart';
import ReadonlyDataTable from './ReadonlyDataTable';

interface Props {
  stage5?: Stage5Data;
  /** 阶段2的表结构 */
  schemaColumns?: Stage2Column[];
  /** 阶段3的实验数据 */
  dataRows?: Record<string, unknown>[];
  /** 是否在文末只读展示学生填写的结论/局限讨论（阶段6=true；阶段5由 ReportViewer 编辑） */
  showStudentFields?: boolean;
}

const AI_FIELDS: { key: keyof Stage5Data['sections']; label: string }[] = [
  { key: 'purpose', label: '研究目的' },
  { key: 'hypothesis', label: '假设' },
  { key: 'materials', label: '实验材料' },
  { key: 'procedure', label: '实验步骤' },
  { key: 'dataSummary', label: '数据概述' },
  { key: 'analysis', label: '数据分析' },
];

/**
 * 只读的完整实验报告视图：平台预填六节 + 嵌入数据表 + （可选）学生结论/局限讨论 +
 * 学生上传的报告 + 评分。被 ReportViewer（阶段5）与 Stage6Panel（阶段6）复用，
 * 使数据表与完整报告在第五、第六阶段都可见，消除「进入下一阶段后表格消失」的观感。
 */
export default function ReportDocument({ stage5, schemaColumns, dataRows, showStudentFields = true }: Props) {
  const sections = stage5?.sections;
  if (!sections) return null;

  const hasTable = !!(dataRows && dataRows.length > 0 && schemaColumns && schemaColumns.length > 0);

  return (
    <div className="space-y-4">
      {/* AI 预填的报告各节 */}
      {AI_FIELDS.map(({ key, label }) => (
        <div key={key}>
          <div className="caption-upper mb-1.5">{label}</div>
          <div className="whitespace-pre-wrap rounded-md border border-hairline bg-surface-soft p-3 text-sm leading-6 text-body">
            {sections[key] || <span className="text-muted-soft">（AI 未预填）</span>}
          </div>
        </div>
      ))}

      {/* 嵌入的实验数据表，紧跟第 4 阶段同一套图表——报告要能自证结论，不必回上一阶段看图 */}
      {hasTable && (
        <div>
          <div className="caption-upper mb-1.5">实验数据记录</div>
          <ReadonlyDataTable columns={schemaColumns!} rows={dataRows!} />
          <div className="mt-4 rounded-md border border-hairline bg-surface-soft p-3">
            <DataChart
              columns={schemaColumns!}
              rows={dataRows!}
              title="数据图表（与第 4 阶段一致）"
              height={260}
            />
          </div>
        </div>
      )}

      {/* 学生填写的结论 / 局限与讨论（只读展示） */}
      {showStudentFields && (
        <>
          <div>
            {/* 学生自己写的部分用珊瑚小标题区分于平台预填 */}
            <div className="caption-upper mb-1.5 text-coral">结论</div>
            <div className="whitespace-pre-wrap rounded-md border border-hairline bg-surface-soft p-3 text-sm leading-6 text-body">
              {sections.conclusion || <span className="text-muted-soft">（未填写）</span>}
            </div>
          </div>
          <div>
            <div className="caption-upper mb-1.5 text-coral">局限与讨论</div>
            <div className="whitespace-pre-wrap rounded-md border border-hairline bg-surface-soft p-3 text-sm leading-6 text-body">
              {limitationsDiscussion(sections) || <span className="text-muted-soft">（未填写）</span>}
            </div>
          </div>
        </>
      )}

      {/* 上传原文作为附件留存；章节只有在学生确认预览后才写入权威字段。 */}
      {(stage5?.uploadedText || stage5?.uploadedDocUrl) && (
        <details>
          <summary className="mb-1 cursor-pointer text-sm font-medium text-muted">
            学生上传的报告（附件）
            {stage5?.uploadedDocUrl && (
              <a
                href={stage5.uploadedDocUrl}
                className="ml-2 font-normal text-coral hover:text-coral-active"
                target="_blank"
                rel="noreferrer"
              >
                下载原文件
              </a>
            )}
          </summary>
          {stage5?.uploadedText && (
            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-hairline bg-surface-card p-3 text-sm leading-6 text-body">
              {stage5.uploadedText}
            </div>
          )}
        </details>
      )}
    </div>
  );
}

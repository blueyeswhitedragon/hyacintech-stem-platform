"use client";

import React from 'react';
import type { Stage5Data, Stage2Column } from '@/app/models/stageData';
import { limitationsDiscussion } from '@/app/lib/reportFields';

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
          <div className="text-sm font-medium text-gray-600 mb-1">{label}</div>
          <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded p-2">
            {sections[key] || <span className="text-gray-400">（AI 未预填）</span>}
          </div>
        </div>
      ))}

      {/* 嵌入的实验数据表 */}
      {hasTable && (
        <div>
          <div className="text-sm font-medium text-gray-600 mb-1">📊 实验数据记录</div>
          <div className="overflow-x-auto border rounded">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="p-1.5 border text-center w-8">#</th>
                  {schemaColumns!.map((c) => (
                    <th key={c.key} className="p-1.5 border text-left whitespace-nowrap">
                      {c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows!.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="p-1.5 border text-center text-gray-400">{i + 1}</td>
                    {schemaColumns!.map((c) => (
                      <td key={c.key} className="p-1.5 border text-gray-800">
                        {c.type === 'image' && row[c.key] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={String(row[c.key])} alt="" className="h-8 w-8 object-cover rounded" />
                        ) : (
                          String(row[c.key] ?? '—')
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 学生填写的结论 / 局限与讨论（只读展示） */}
      {showStudentFields && (
        <>
          <div>
            <div className="text-sm font-medium text-blue-700 mb-1">结论</div>
            <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded p-2">
              {sections.conclusion || <span className="text-gray-400">（未填写）</span>}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-blue-700 mb-1">局限与讨论</div>
            <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 border rounded p-2">
              {limitationsDiscussion(sections) || <span className="text-gray-400">（未填写）</span>}
            </div>
          </div>
        </>
      )}

      {/* 学生上传的报告（docx 轻量导入，留存 + 文本提取，独立展示，不覆盖 AI 框架） */}
      {(stage5?.uploadedText || stage5?.uploadedDocUrl) && (
        <div>
          <div className="text-sm font-medium text-gray-600 mb-1">
            📎 学生上传的报告
            {stage5?.uploadedDocUrl && (
              <a
                href={stage5.uploadedDocUrl}
                className="ml-2 text-blue-600 underline font-normal"
                target="_blank"
                rel="noreferrer"
              >
                下载原文件
              </a>
            )}
          </div>
          {stage5?.uploadedText && (
            <div className="text-sm text-gray-800 whitespace-pre-wrap bg-amber-50 border border-amber-200 rounded p-2 max-h-64 overflow-y-auto">
              {stage5.uploadedText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

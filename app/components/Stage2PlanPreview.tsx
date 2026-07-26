"use client";

import React, { useMemo, useState } from 'react';
import type {
  Stage2CoreField,
  Stage2ExperimentPlan,
  Stage2PlanProvenance,
  Stage2PlanProvenanceSource,
  Stage2Readiness,
  Stage2SectionId,
} from '../models/stageData';
import {
  STAGE2_CORE_FIELD_LABELS,
  STAGE2_SECTIONS,
} from '../lib/stage2Readiness';
import { buildDataTableSchema } from '../lib/stageArtifacts';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Callout from './ui/Callout';
import { Input, Textarea } from './ui/Field';

interface Props {
  plan?: Stage2ExperimentPlan;
  draftHash?: string;
  readiness: Stage2Readiness;
  provenance?: Stage2PlanProvenance;
  confirmed: boolean;
  onConfirm?: (draftHash: string) => Promise<string | null>;
  onSaveFields?: (fields: Partial<Record<Stage2CoreField, string>>) => Promise<string | null>;
  roundCount?: number;
  confirmLabel?: string;
}

function ListValue({ values, emptyLabel = '无（已确认）' }: { values: string[]; emptyLabel?: string }) {
  return <span>{values.length ? values.join('、') : emptyLabel}</span>;
}

function SourceLabel({ source }: { source?: Stage2PlanProvenanceSource }) {
  if (!source) return null;
  const label = source === 'student_form'
    ? '学生直接填写'
    : source === 'teacher_release'
      ? '教师放行补充'
    : source === 'student_fact'
      ? '学生提供'
      : source === 'server_baseline'
        ? '安全基线'
        : '系统组装';
  return <span className="ml-2 text-xs font-normal text-muted">{label}</span>;
}

const FIELD_PLACEHOLDERS: Record<Stage2CoreField, string> = {
  independent_variable: '例如：纸桥的截面形状',
  levels: '例如：方形、圆形',
  dependent_variable: '例如：桥塌下时承载的砝码质量',
  measurement_tool: '例如：5g 砝码、电子秤',
  measurement_timing: '例如：逐个加砝码，直到桥塌下时读数',
  recorded_fields: '例如：截面形状、砝码个数、总质量',
  procedure: '每行或用分号写一个步骤',
  controls: '用顿号分隔；确实没有可填写“无”',
  repeats: '例如：3',
  hypothesis: '例如：方形截面纸桥比圆形截面承重更多',
};

const MULTILINE_FIELDS = new Set<Stage2CoreField>(['levels', 'recorded_fields', 'procedure', 'controls', 'hypothesis']);

// 四个环节卡片原本是同一段 markup 复制四遍，只有标题和 sectionId 不同。
const DL = 'grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5';
const DT = 'text-muted';

function PlanSection({
  title, sectionId, confirmed, onEdit, children,
}: {
  title: string;
  sectionId: Stage2SectionId;
  confirmed: boolean;
  onEdit: (id: Stage2SectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-hairline p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-medium text-ink">{title}</h3>
        {!confirmed && (
          <button
            type="button"
            onClick={() => onEdit(sectionId)}
            className="shrink-0 text-xs text-coral transition-colors duration-[120ms] hover:text-coral-active"
          >
            修改本环节
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export default function Stage2PlanPreview({
  plan,
  draftHash,
  readiness,
  provenance,
  confirmed,
  onConfirm,
  onSaveFields,
  roundCount = 0,
  confirmLabel = '确认当前方案',
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<Stage2SectionId | null>(null);
  const [fieldValues, setFieldValues] = useState<Partial<Record<Stage2CoreField, string>>>({});
  const completedSections = new Set(readiness.completedSections ?? []);
  const activeSection = readiness.missingSections?.[0] ?? null;
  const schema = useMemo(() => plan ? buildDataTableSchema(plan) : null, [plan]);
  const selectedSection = STAGE2_SECTIONS.find((section) => section.id === editingSection);
  const missingSelectedFields = selectedSection?.fields.filter((field) => readiness.missingFields.includes(field)) ?? [];
  const selectedFields = selectedSection
    ? missingSelectedFields.length > 0 ? missingSelectedFields : selectedSection.fields
    : [];

  const confirm = async () => {
    if (!onConfirm || !draftHash || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onConfirm(draftHash);
      if (result) setError(result);
    } finally {
      setBusy(false);
    }
  };

  const saveFields = async () => {
    if (!onSaveFields || !selectedSection || busy) return;
    const fields = Object.fromEntries(
      selectedFields
        .map((field) => [field, fieldValues[field]?.trim()] as const)
        .filter((entry): entry is [Stage2CoreField, string] => Boolean(entry[1])),
    ) as Partial<Record<Stage2CoreField, string>>;
    if (Object.keys(fields).length === 0) {
      setError('请至少填写一个字段');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onSaveFields(fields);
      if (result) setError(result);
      else {
        setEditingSection(null);
        setFieldValues({});
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-hairline bg-canvas px-4 py-4" aria-label="实验方案预览">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="display-sm">{plan ? '实验方案预览' : '方案设计四环节'}</h2>
        <Badge tone={confirmed ? 'success' : readiness.complete ? 'coral' : 'neutral'}>
          {confirmed
            ? '已确认并冻结'
            : readiness.complete
              ? '待确认'
              : `已完成 ${completedSections.size}/4 个环节`}
        </Badge>
      </div>

      {roundCount >= 8 && !confirmed && readiness.missingSections.length > 0 && onSaveFields && (
        <div className="mb-4">
          <Callout
            tone="info"
            actions={<Button size="sm" onClick={() => setEditingSection(readiness.missingSections[0])}>直接填写</Button>}
          >
            也可以直接填写尚缺的方案信息。
          </Callout>
        </div>
      )}

      {/* 四环节状态：已完成用绿描边，进行中用珊瑚描边（"该我说话了"），未开始留白。 */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2" aria-label="方案四环节状态">
        {STAGE2_SECTIONS.map((section, index) => {
          const done = completedSections.has(section.id);
          const active = section.id === activeSection;
          return (
            <div
              key={section.id}
              className={`rounded-lg border px-3 py-2 ${
                done
                  ? 'border-success/35 bg-success/8'
                  : active
                    ? 'border-coral/45 bg-coral/8'
                    : 'border-hairline bg-surface-soft'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">
                  {index + 1}. {section.title.replace(/^环节[一二三四]：/, '')}
                </p>
                <span className="text-xs text-muted">{done ? '已完成' : active ? '进行中' : '待开始'}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted">{section.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {section.fields.map((field) => (
                  <span
                    key={field}
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      readiness.completedFields.includes(field)
                        ? 'bg-canvas text-[#2f7a43]'
                        : 'bg-canvas/70 text-muted-soft'
                    }`}
                  >
                    {STAGE2_CORE_FIELD_LABELS[field]}
                  </span>
                ))}
              </div>
              {!done && onSaveFields && !confirmed && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setEditingSection(section.id)}>
                  直接填写本环节
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {!plan && activeSection && (
        <p className="text-sm leading-6 text-body">
          当前进行：{STAGE2_SECTIONS.find((section) => section.id === activeSection)?.title}。
          本环节可以在一条消息中完整说明，平台会一次接收所有明确内容。
        </p>
      )}

      {plan && (
        <div className="space-y-3 text-sm">
          <PlanSection title="环节一：明确变量设计" sectionId="variable_design" confirmed={confirmed} onEdit={setEditingSection}>
            <dl className={DL}>
              <dt className={DT}>研究问题</dt><dd>{plan.researchQuestion}</dd>
              <dt className={DT}>唯一变量</dt><dd>{plan.independentVariable.name}<SourceLabel source={provenance?.independentVariable?.source} /></dd>
              <dt className={DT}>变量水平</dt><dd><ListValue values={plan.independentVariable.levels} /><SourceLabel source={provenance?.levels?.source} /></dd>
              <dt className={DT}>观测指标</dt><dd>{plan.dependentVariable.name}<SourceLabel source={provenance?.dependentVariable?.source} /></dd>
            </dl>
          </PlanSection>

          <PlanSection title="环节二：思考数据记录" sectionId="data_recording" confirmed={confirmed} onEdit={setEditingSection}>
            <dl className={DL}>
              <dt className={DT}>测量工具</dt><dd>{plan.dataRecording?.tool || plan.dependentVariable.measurement}<SourceLabel source={provenance?.dataRecording?.source} /></dd>
              <dt className={DT}>读数时间</dt><dd>{plan.dataRecording?.timing || '见测量方式（历史方案）'}<SourceLabel source={provenance?.dataRecording?.source} /></dd>
              <dt className={DT}>记录数据</dt><dd><ListValue values={plan.dataRecording?.recordedFields ?? [plan.dependentVariable.name]} /><SourceLabel source={provenance?.dataRecording?.source} /></dd>
              <dt className={DT}>完整方式</dt>
              <dd>{plan.dependentVariable.measurement}{plan.dependentVariable.unit ? `（${plan.dependentVariable.unit}）` : ''}</dd>
            </dl>
          </PlanSection>

          <PlanSection title="环节三：规划实验过程" sectionId="experiment_process" confirmed={confirmed} onEdit={setEditingSection}>
            <dl className={DL}>
              <dt className={DT}>控制条件</dt><dd><ListValue values={plan.controlledVariables} /><SourceLabel source={provenance?.controlledVariables?.source} /></dd>
              {plan.sampleSizePerLevel && <><dt className={DT}>每组样本</dt><dd>{plan.sampleSizePerLevel} 个实验对象</dd></>}
              <dt className={DT}>独立重复</dt><dd>每个水平 {plan.repeatCount} 轮<SourceLabel source={provenance?.repeatCount?.source} /></dd>
              <dt className={DT}>材料</dt>
              <dd><ListValue values={plan.materials} emptyLabel="尚未说明" /><SourceLabel source={provenance?.materials?.source} /></dd>
              <dt className={DT}>操作步骤</dt>
              <dd>
                <ol className="list-decimal space-y-1 pl-5">
                  {plan.procedure.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
                </ol>
                <SourceLabel source={provenance?.procedure?.source} />
              </dd>
              <dt className={DT}>安全事项</dt>
              <dd><ListValue values={plan.safetyNotes} /><SourceLabel source={provenance?.safetyNotes?.source} /></dd>
            </dl>
          </PlanSection>

          <PlanSection title="环节四：推测实验结果" sectionId="expected_result" confirmed={confirmed} onEdit={setEditingSection}>
            <p className="text-body">{plan.hypothesis}<SourceLabel source={provenance?.hypothesis?.source} /></p>
          </PlanSection>

          {schema && (
            <div className="rounded-lg border border-hairline bg-surface-soft p-3">
              <h3 className="font-medium text-ink">原始数据记录表预览</h3>
              <p className="mt-1 text-xs text-muted">确认后将冻结以下列结构，至少记录 {schema.minRows} 行。</p>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {schema.columns.map((column) => (
                        <th key={column.key} className="whitespace-nowrap border border-hairline bg-canvas px-2 py-1.5 text-left font-medium text-body">
                          {column.title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {editingSection && !confirmed && (
        <div className="mt-3 rounded-lg border border-hairline bg-surface-soft p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium text-ink">{selectedSection?.title}</h3>
            <Button size="sm" variant="ghost" onClick={() => { setEditingSection(null); setError(null); }}>关闭</Button>
          </div>
          <div className="mt-3 space-y-3">
            {selectedFields.map((field) => (
              <label key={field} className="block text-sm font-medium text-body">
                {STAGE2_CORE_FIELD_LABELS[field]}
                {MULTILINE_FIELDS.has(field) ? (
                  <Textarea
                    className="mt-1.5"
                    rows={field === 'procedure' ? 4 : 2}
                    value={fieldValues[field] ?? ''}
                    placeholder={FIELD_PLACEHOLDERS[field]}
                    onChange={(event) => setFieldValues((previous) => ({ ...previous, [field]: event.target.value }))}
                  />
                ) : (
                  <Input
                    className="mt-1.5"
                    type={field === 'repeats' ? 'number' : 'text'}
                    min={field === 'repeats' ? 1 : undefined}
                    max={field === 'repeats' ? 20 : undefined}
                    value={fieldValues[field] ?? ''}
                    placeholder={FIELD_PLACEHOLDERS[field]}
                    onChange={(event) => setFieldValues((previous) => ({ ...previous, [field]: event.target.value }))}
                  />
                )}
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" onClick={saveFields} disabled={busy}>{busy ? '保存中…' : '保存本环节'}</Button>
            {error && <p className="text-sm text-error">{error}</p>}
          </div>
        </div>
      )}

      {plan && !confirmed && onConfirm && draftHash && (
        <div className="mt-4 border-t border-hairline pt-4">
          <Button variant="primary" onClick={confirm} disabled={busy}>
            {busy ? '正在确认…' : confirmLabel}
          </Button>
          {error && <p className="mt-2 text-sm text-error">{error}</p>}
        </div>
      )}
    </section>
  );
}

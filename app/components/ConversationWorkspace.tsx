"use client";

import React, { useEffect, useState } from 'react';
import type { Message, SafetyQuiz } from '../models/types';
import type { StageData, Stage2CoreField, Stage3FileAssociation, AssignmentStatus } from '../models/stageData';
import type { AdvanceHint } from '../lib/advanceHint';
import ConversationChat, { type ChatApiResponse } from './ConversationChat';
import DataTableEditor from './DataTableEditor';
import ChartViewer from './ChartViewer';
import ReportViewer from './ReportViewer';
import Stage6Panel from './Stage6Panel';
import Stage2PlanPreview from './Stage2PlanPreview';
import Fireworks from './Fireworks';
import { evaluateStage2Readiness } from '../lib/stage2Readiness';
import Button from './ui/Button';
import Callout from './ui/Callout';

interface Props {
  conversationId: string;
  initialMessages: Message[];
  initialStage: number;
  initialStageData: StageData;
  initialStatus: AssignmentStatus;
  initialSafetyQuizCompleted: boolean;
  initialAdvanceHint: AdvanceHint;
  initialSafetyQuiz?: SafetyQuiz | null;
  initialDueDate?: string | null;
}

function hydrateStage1Confirmation(messages: Message[], stageData: StageData): Message[] {
  const stage1 = stageData.stage1;
  if (!stage1?.confirmed || !stage1.snapshot) return messages;
  const existingIndex = messages.map((message) => message.messageType).lastIndexOf('confirmation_doc');
  if (existingIndex >= 0) {
    return messages.map((message, index) => index === existingIndex
      ? { ...message, actionType: 'confirmation', phaseComplete: true }
      : message);
  }
  return [...messages, {
    id: `stage1-confirmation-${stage1.confirmedQuestionHash ?? 'legacy'}`,
    role: 'assistant',
    content: stage1.snapshot,
    messageType: 'confirmation_doc',
    actionType: 'confirmation',
    phaseComplete: true,
    status: 'sent',
  }];
}

export default function ConversationWorkspace({
  conversationId,
  initialMessages,
  initialStage,
  initialStageData,
  initialStatus,
  initialSafetyQuizCompleted,
  initialAdvanceHint,
  initialSafetyQuiz = null,
  initialDueDate,
}: Props) {
  const [hydratedMessages] = useState(() => hydrateStage1Confirmation(initialMessages, initialStageData));
  const [stage, setStage] = useState(initialStage);
  const [stageData, setStageData] = useState<StageData>(initialStageData);
  const [status, setStatus] = useState<AssignmentStatus>(initialStatus);
  const [completed, setCompleted] = useState(initialStatus === 'COMPLETED');
  const [injectedMessage, setInjectedMessage] = useState<Message | null>(null);
  const [safetyQuizCompleted, setSafetyQuizCompleted] = useState(initialSafetyQuizCompleted);
  const [serverAdvanceHint, setServerAdvanceHint] = useState(initialAdvanceHint);
  const [overdue, setOverdue] = useState(false);

  useEffect(() => {
    if (!initialDueDate) return;
    const remaining = new Date(initialDueDate).getTime() - Date.now();
    const timer = window.setTimeout(() => setOverdue(true), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [initialDueDate]);
  // 发送消息到会话端点（ConversationChat 注入；服务端已有历史，忽略 history 参数）
  const sendChat = async (message: string): Promise<ChatApiResponse> => {
    const res = await fetch(`/api/conversations/${conversationId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || '请求失败，请重试。');
    return data as ChatApiResponse;
  };

  const markSafetyPassed = async (selected: number) => {
    const response = await fetch(`/api/conversations/${conversationId}/safety-quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: selected }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '安全问答提交失败');
    setSafetyQuizCompleted(true);
    if (data.stageData) setStageData(data.stageData);
    if (data.advanceHint) setServerAdvanceHint(data.advanceHint);
  };

  // chat 响应后，以服务端返回的真相更新 stage / stageData
  const onChatResult = (data: ChatApiResponse) => {
    if (typeof data.currentStage === 'number') setStage(data.currentStage);
    if (data.stageData) setStageData(data.stageData);
    if (data.advanceHint) setServerAdvanceHint(data.advanceHint);
  };

  // 通用 POST helper：成功后用返回的 {stageData,status,currentStage} 更新本地态
  const postAction = async (path: string, body?: unknown): Promise<string | null> => {
    const res = await fetch(`/api/conversations/${conversationId}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) return data.error || '操作失败';
    if (data.stageData) setStageData(data.stageData);
    if (data.advanceHint) setServerAdvanceHint(data.advanceHint);
    if (data.status) {
      setStatus(data.status);
      if (data.status === 'COMPLETED') setCompleted(true);
    }
    if (typeof data.currentStage === 'number') setStage(data.currentStage);
    return null;
  };

  const submitStage2 = () => postAction('submit-stage2');
  const submitStage5 = () => postAction('submit-stage5');
  const respondStage6 = (responseToTeacherFeedback: string, learningReflection: string) => postAction('stage6-respond', {
    responseToTeacherFeedback,
    learningReflection,
  });

  const confirmStage2Plan = async (draftHash: string): Promise<string | null> => {
    const res = await fetch(`/api/conversations/${conversationId}/confirm-stage2-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftHash }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error || '方案确认失败';
    if (data.stageData) setStageData(data.stageData);
    if (data.advanceHint) setServerAdvanceHint(data.advanceHint);
    return null;
  };

  const saveStage2Fields = async (
    fields: Partial<Record<Stage2CoreField, string>>,
  ): Promise<string | null> => {
    const res = await fetch(`/api/conversations/${conversationId}/stage2-fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error || '方案字段保存失败';
    if (data.stageData) setStageData(data.stageData);
    if (data.advanceHint) setServerAdvanceHint(data.advanceHint);
    return null;
  };

  // PATCH 保存阶段3数据；返回 error 字符串或 null
  const saveStage3 = async (
    rows: Record<string, unknown>[],
    fileAssociations: Stage3FileAssociation[]
  ): Promise<string | null> => {
    const res = await fetch(`/api/conversations/${conversationId}/stage-data`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage3: { rows, fileAssociations } }),
    });
    const data = await res.json();
    if (!res.ok) return data.error || '保存失败';
    setStageData(data.stageData);
    if (data.advanceHint) setServerAdvanceHint(data.advanceHint);
    return null;
  };

  const saveStage5 = async (conclusion: string, limitationsDiscussion: string): Promise<string | null> => {
    const res = await fetch(`/api/conversations/${conversationId}/stage-data`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage5: { conclusion, limitationsDiscussion } }),
    });
    const data = await res.json();
    if (!res.ok) return data.error || '保存失败';
    setStageData(data.stageData);
    if (data.advanceHint) setServerAdvanceHint(data.advanceHint);
    return null;
  };

  const advanceTo = async (to: number): Promise<string | null> => {
    const res = await fetch(`/api/conversations/${conversationId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    });
    const data = await res.json();
    if (!res.ok) return data.error || '推进失败';
    setStage(data.currentStage);
    if (data.stageData) setStageData(data.stageData);
    if (data.advanceHint) setServerAdvanceHint(data.advanceHint);
    if (data.transitionMessage) setInjectedMessage(data.transitionMessage as Message);
    return null;
  };

  const advanceToStage5 = async (): Promise<string | null> => advanceTo(5);

  /** 导出报告为 docx 并触发浏览器下载。 */
  const exportReportDocx = async (): Promise<string | null> => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/report/export`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return data.error || '导出失败，请稍后重试。';
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '实验报告.docx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return null;
    } catch {
      return '导出失败，请稍后重试。';
    }
  };

  /** 上传学生自己的 docx 报告（轻量留存 + 文本提取）。 */
  const importReportDocx = async (file: File): Promise<string | null> => {
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/conversations/${conversationId}/report/import`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error || '上传失败，请稍后重试。';
      if (data.stageData) setStageData(data.stageData);
      return null;
    } catch {
      return '上传失败，请稍后重试。';
    }
  };

  const confirmReportImport = async (previewHash: string): Promise<string | null> => {
    const res = await fetch(`/api/conversations/${conversationId}/report/import/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewHash }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error || '导入失败，请重新上传后重试。';
    if (data.stageData) setStageData(data.stageData);
    return null;
  };

  /** 阶段完成后的确认推进；/advance 会原子生成并返回助手主动过渡消息。 */
  const onPhaseConfirm = async (): Promise<string | null> => {
    return advanceTo(stage + 1);
  };

  const pendingStage2 = status === 'PENDING_STAGE2';
  const pendingStage5 = status === 'PENDING_STAGE5';
  const readOnlyReason = completed
    ? '探究已完成，内容已锁定。'
    : pendingStage2 || pendingStage5
      ? '已提交教师审核，审核完成前内容只读。'
      : undefined;
  const lateRecorded = (stageData.timeline?.lateEvents.length ?? 0) > 0;
  const rejected2 = stageData.stage2?.approved === false ? stageData.stage2.teacherFeedback : null;
  const rejected3 = stageData.stage3?.approved === false ? stageData.stage3.teacherFeedback : null;
  const rejected5 = stageData.stage5?.approved === false ? stageData.stage5.teacherFeedback : null;

  const banner = (() => {
    if (pendingStage2 || pendingStage5) {
      return (
        <div className="m-4">
          {/* 等审核是「在等别人」而非出错，用中性信息色而非警告黄 */}
          <Callout tone="info">已提交，正在等待教师审核。审核通过后即可继续。</Callout>
        </div>
      );
    }
    const fb = stage === 2 ? rejected2 : stage === 3 ? rejected3 : stage === 5 ? rejected5 : null;
    if (fb) {
      return (
        <div className="m-4">
          <Callout tone="warning" title="教师驳回，请修改后重新提交">
            <div className="whitespace-pre-wrap">{fb}</div>
          </Callout>
        </div>
      );
    }
    return null;
  })();

  const panel = renderPanel();

  function renderPanel() {
    switch (stage) {
      case 2:
        const formalStage2 = stageData.stage2;
        const readiness = evaluateStage2Readiness(stageData);
        const planConfirmed = Boolean(formalStage2?.confirmedPlanHash
          && formalStage2.confirmedPlanHash === formalStage2.draftHash
          && formalStage2.experimentPlan);
        return (
          <div>
            {banner}
            <Stage2PlanPreview
              plan={formalStage2?.planDraft}
              draftHash={formalStage2?.draftHash}
              readiness={readiness}
              provenance={formalStage2?.planProvenance}
              confirmed={planConfirmed}
              onConfirm={pendingStage2 || planConfirmed ? undefined : confirmStage2Plan}
              onSaveFields={pendingStage2 || planConfirmed ? undefined : saveStage2Fields}
              roundCount={stageData.roundCounts?.[2] ?? 0}
            />
            {planConfirmed && formalStage2 && formalStage2.schema.columns.length > 0 && (
              <section className="border-b border-hairline px-4 py-4">
                <h2 className="mb-2 text-sm font-medium text-ink">数据表结构</h2>
                <div className="space-y-1 text-sm text-body">
                  {formalStage2.schema.columns.map((column) => (
                    <div key={column.key} className="flex justify-between gap-3 border-b border-hairline-soft py-1 last:border-0">
                      <span>{column.title}</span>
                      <span className="text-xs text-muted">{column.type}{column.required ? ' · 必填' : ''}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {planConfirmed && formalStage2?.aiRiskAnnotations && formalStage2.aiRiskAnnotations.length > 0 && (
              <div className="mx-4 mb-3">
                <Callout tone="warning" title="安全 / 风险提示">
                  {formalStage2.aiRiskAnnotations.map((r, i) => (
                    <div key={i}>· {r.description}（{r.severity}）</div>
                  ))}
                </Callout>
              </div>
            )}
            {planConfirmed && !pendingStage2 && (
              <div className="px-4 pb-4">
                <Button variant="primary" onClick={submitStage2}>
                  提交方案，等待教师审核
                </Button>
              </div>
            )}
          </div>
        );
      case 3:
        return (
          <div>
            {banner}
            <DataTableEditor
              schema={stageData.stage2?.schema}
              initial={stageData.stage3}
              onSave={saveStage3}
              onComplete={() => advanceTo(4)}
              disabledReason={safetyQuizCompleted || stageData.stage3?.safetyQuiz?.passed === true ? undefined : '请先在左侧完成安全问答，答对后才能录入实验数据。'}
            />
          </div>
        );
      case 4:
        return (
          <ChartViewer
            schema={stageData.stage2?.schema}
            stage3={stageData.stage3}
            stage4={stageData.stage4}
            onComplete={advanceToStage5}
          />
        );
      case 5:
        return (
          <div>
            {banner}
            <ReportViewer
              key={stageData.stage5?.lastConfirmedImport?.previewHash ?? 'stage5-report'}
              stage5={stageData.stage5}
              schemaColumns={stageData.stage2?.schema?.columns}
              dataRows={stageData.stage3?.rows}
              onSave={saveStage5}
              onSubmit={pendingStage5 ? undefined : submitStage5}
              onExport={exportReportDocx}
              onImport={pendingStage5 ? undefined : importReportDocx}
              onConfirmImport={pendingStage5 ? undefined : confirmReportImport}
            />
          </div>
        );
      case 6:
        return (
          <Stage6Panel
            stage5={stageData.stage5}
            stage6={stageData.stage6}
            completed={status === 'COMPLETED'}
            onSubmit={respondStage6}
            schemaColumns={stageData.stage2?.schema?.columns}
            dataRows={stageData.stage3?.rows}
          />
        );
      default:
        return null;
    }
  }

  const chat = (
    <ConversationChat
      initialMessages={hydratedMessages}
      stage={stage}
      completed={completed}
      send={sendChat}
      onResult={onChatResult}
      onSafetyPassed={markSafetyPassed}
      onPhaseConfirm={stage === 1 ? onPhaseConfirm : undefined}
      phaseConfirmLabel="研究问题无误，进入方案设计"
      roundCount={stageData.roundCounts?.[stage] ?? 0}
      advanceReady={serverAdvanceHint.to === stage + 1 && serverAdvanceHint.ok}
      advanceReason={serverAdvanceHint.to === stage + 1 ? serverAdvanceHint.reason : undefined}
      injectedMessage={injectedMessage}
      initialSafetyQuiz={stage === 3 && !safetyQuizCompleted
        ? stageData.stage3?.safetyQuiz && !stageData.stage3.safetyQuiz.passed
          ? { question: stageData.stage3.safetyQuiz.question, options: stageData.stage3.safetyQuiz.options }
          : initialSafetyQuiz
        : null}
      readOnlyReason={readOnlyReason}
    />
  );
  const documentStage = stage === 5 || stage === 6;
  const chatWidth = stage === 4 ? 'lg:w-2/5' : 'lg:w-1/2';
  const panelWidth = stage === 4 ? 'lg:w-3/5' : 'lg:w-1/2';

  return (
    <div className="density-roomy flex h-full min-h-0 flex-col">
      {overdue && !completed && (
        <div className="mb-3">
          <Callout tone="warning">
            已超过截止时间，仍可继续完成；后续里程碑提交会记录为迟交{lateRecorded ? '（已记录）' : ''}。
          </Callout>
        </div>
      )}
      {documentStage && panel ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <main className="order-1 min-h-fit min-w-0 shrink-0 rounded-lg border border-hairline bg-canvas lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-y-auto">
            {panel}
          </main>
          <aside className="order-2 shrink-0 lg:w-80">
            <details className="rounded-lg border border-hairline bg-canvas">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-ink">
                AI 导师（可选辅导）
                <span className="ml-2 text-xs font-normal text-muted">点击展开</span>
              </summary>
              <div className="h-[32rem] min-h-0 border-t border-hairline">
                {chat}
              </div>
            </details>
          </aside>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <div className={`flex h-[38rem] min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-hairline bg-canvas lg:h-auto lg:shrink ${panel ? chatWidth : 'w-full'}`}>
            <div className="min-h-0 flex-1">{chat}</div>
          </div>
          {panel && (
            <div className={`min-h-fit shrink-0 rounded-lg border border-hairline bg-canvas lg:min-h-0 lg:shrink lg:overflow-y-auto ${panelWidth}`}>
              {panel}
            </div>
          )}
        </div>
      )}
      {completed && <Fireworks />}
    </div>
  );
}

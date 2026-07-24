"use client";

import React, { useEffect, useState } from 'react';
import type { Message } from '../models/types';
import type { StageData, Stage3FileAssociation, AssignmentStatus } from '../models/stageData';
import ConversationChat, { type ChatApiResponse } from './ConversationChat';
import DataTableEditor from './DataTableEditor';
import ChartViewer from './ChartViewer';
import ReportViewer from './ReportViewer';
import Stage6Panel from './Stage6Panel';
import Stage2PlanPreview from './Stage2PlanPreview';
import Fireworks from './Fireworks';
import { evaluateStage2Readiness } from '../lib/stage2Readiness';

interface Props {
  conversationId: string;
  initialMessages: Message[];
  initialStage: number;
  initialStageData: StageData;
  initialStatus: AssignmentStatus;
  initialSafetyQuizCompleted: boolean;
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
  initialDueDate,
}: Props) {
  const [hydratedMessages] = useState(() => hydrateStage1Confirmation(initialMessages, initialStageData));
  const [stage, setStage] = useState(initialStage);
  const [stageData, setStageData] = useState<StageData>(initialStageData);
  const [status, setStatus] = useState<AssignmentStatus>(initialStatus);
  const [completed, setCompleted] = useState(initialStatus === 'COMPLETED');
  const [injectedMessage, setInjectedMessage] = useState<Message | null>(null);
  const [safetyQuizCompleted, setSafetyQuizCompleted] = useState(initialSafetyQuizCompleted);
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
  };

  // chat 响应后，以服务端返回的真相更新 stage / stageData
  const onChatResult = (data: ChatApiResponse) => {
    if (typeof data.currentStage === 'number') setStage(data.currentStage);
    if (data.stageData) setStageData(data.stageData);
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
        <div className="m-4 p-3 bg-amber-50 border border-amber-300 rounded text-sm text-amber-800">
          ⏳ 已提交，正在等待教师审核。审核通过后即可继续。
        </div>
      );
    }
    const fb = stage === 2 ? rejected2 : stage === 3 ? rejected3 : stage === 5 ? rejected5 : null;
    if (fb) {
      return (
        <div className="m-4 p-3 bg-red-50 border border-red-300 rounded text-sm text-red-800">
          <div className="font-medium mb-1">教师驳回，请修改后重新提交</div>
          <div className="whitespace-pre-wrap">{fb}</div>
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
        const readiness = formalStage2?.readiness ?? evaluateStage2Readiness(stageData);
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
            />
            {planConfirmed && formalStage2 && formalStage2.schema.columns.length > 0 && (
              <section className="border-b border-gray-200 px-4 py-4">
                <h2 className="mb-2 text-sm font-semibold text-gray-900">数据表结构</h2>
                <div className="space-y-1 text-sm text-gray-700">
                  {formalStage2.schema.columns.map((column) => (
                    <div key={column.key} className="flex justify-between gap-3 border-b border-gray-100 py-1 last:border-0">
                      <span>{column.title}</span>
                      <span className="text-xs text-gray-500">{column.type}{column.required ? ' · 必填' : ''}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {planConfirmed && formalStage2?.aiRiskAnnotations && formalStage2.aiRiskAnnotations.length > 0 && (
              <div className="mx-4 mb-3 bg-amber-50 border border-amber-200 rounded p-2 text-sm">
                <div className="font-medium text-amber-800 mb-1">⚠️ 安全/风险提示</div>
                {formalStage2.aiRiskAnnotations.map((r, i) => (
                  <div key={i} className="text-amber-700">· {r.description}（{r.severity}）</div>
                ))}
              </div>
            )}
            {planConfirmed && !pendingStage2 && (
              <div className="px-4 pb-4">
                <button
                  onClick={submitStage2}
                  className="px-4 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600"
                >
                  提交方案，等待教师审核
                </button>
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
            onComplete={advanceToStage5}
          />
        );
      case 5:
        return (
          <div>
            {banner}
            <ReportViewer
              stage5={stageData.stage5}
              schemaColumns={stageData.stage2?.schema?.columns}
              dataRows={stageData.stage3?.rows}
              onSave={saveStage5}
              onSubmit={pendingStage5 ? undefined : submitStage5}
              onExport={exportReportDocx}
              onImport={pendingStage5 ? undefined : importReportDocx}
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {overdue && !completed && (
        <div className="mb-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          已超过截止时间，仍可继续完成；后续里程碑提交会记录为迟交{lateRecorded ? '（已记录）' : ''}。
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <div className={`bg-white rounded-lg shadow-sm overflow-hidden ${panel ? 'lg:w-1/2' : 'w-full'} min-h-0 flex flex-col`}>
        <div className="min-h-0 flex-1">
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
            injectedMessage={injectedMessage}
            initialSafetyQuiz={stage === 3 && stageData.stage3?.safetyQuiz && !stageData.stage3.safetyQuiz.passed
              ? { question: stageData.stage3.safetyQuiz.question, options: stageData.stage3.safetyQuiz.options }
              : null}
            readOnlyReason={readOnlyReason}
          />
        </div>
      </div>
      {panel && (
        <div className="bg-white rounded-lg shadow-sm overflow-y-auto lg:w-1/2 min-h-0">
          {panel}
        </div>
      )}
      {completed && <Fireworks />}
      </div>
    </div>
  );
}

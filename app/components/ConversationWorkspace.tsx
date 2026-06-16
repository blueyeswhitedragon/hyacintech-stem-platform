"use client";

import React, { useState } from 'react';
import type { Message } from '../models/types';
import type { StageData, Stage3FileAssociation, AssignmentStatus } from '../models/stageData';
import ConversationChat, { type ChatApiResponse } from './ConversationChat';
import DataTableEditor from './DataTableEditor';
import ChartViewer from './ChartViewer';
import ReportViewer from './ReportViewer';
import Stage6Panel from './Stage6Panel';

interface Props {
  conversationId: string;
  initialMessages: Message[];
  initialStage: number;
  initialStageData: StageData;
  initialStatus: AssignmentStatus;
}

export default function ConversationWorkspace({
  conversationId,
  initialMessages,
  initialStage,
  initialStageData,
  initialStatus,
}: Props) {
  const [stage, setStage] = useState(initialStage);
  const [stageData, setStageData] = useState<StageData>(initialStageData);
  const [status, setStatus] = useState<AssignmentStatus>(initialStatus);

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

  const markSafetyPassed = async () => {
    await fetch(`/api/conversations/${conversationId}/safety-quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passed: true }),
    });
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
    if (data.status) setStatus(data.status);
    if (typeof data.currentStage === 'number') setStage(data.currentStage);
    return null;
  };

  const submitStage2 = () => postAction('submit-stage2');
  const submitStage5 = () => postAction('submit-stage5');
  const respondStage6 = (response: string) => postAction('stage6-respond', { response });

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

  const saveStage5 = async (conclusion: string, reflection: string): Promise<string | null> => {
    const res = await fetch(`/api/conversations/${conversationId}/stage-data`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage5: { conclusion, reflection } }),
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
    return null;
  };

  const pendingStage2 = status === 'PENDING_STAGE2';
  const pendingStage5 = status === 'PENDING_STAGE5';
  const rejected2 = stageData.stage2?.approved === false ? stageData.stage2.teacherFeedback : null;
  const rejected5 = stageData.stage5?.approved === false ? stageData.stage5.teacherFeedback : null;

  const banner = (() => {
    if (pendingStage2 || pendingStage5) {
      return (
        <div className="m-4 p-3 bg-amber-50 border border-amber-300 rounded text-sm text-amber-800">
          ⏳ 已提交，正在等待教师审核。审核通过后即可继续。
        </div>
      );
    }
    const fb = stage === 2 ? rejected2 : stage === 5 ? rejected5 : null;
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
        if (!stageData.stage2?.schema) return null;
        return (
          <div className="p-4">
            {banner}
            <h3 className="font-medium mb-2">数据表结构预览</h3>
            <ul className="text-sm text-gray-700 list-disc pl-5 mb-3">
              {stageData.stage2.schema.columns.map((c) => (
                <li key={c.key}>
                  {c.title}（{c.type}）{c.required && <span className="text-red-500">必填</span>}
                </li>
              ))}
            </ul>
            {stageData.stage2.aiRiskAnnotations && stageData.stage2.aiRiskAnnotations.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded p-2 text-sm mb-3">
                <div className="font-medium text-amber-800 mb-1">⚠️ 安全/风险提示</div>
                {stageData.stage2.aiRiskAnnotations.map((r, i) => (
                  <div key={i} className="text-amber-700">· {r.description}（{r.severity}）</div>
                ))}
              </div>
            )}
            {!pendingStage2 && (
              <SubmitButton label="提交方案，等待教师审核" onSubmit={submitStage2} />
            )}
          </div>
        );
      case 3:
        return (
          <DataTableEditor
            schema={stageData.stage2?.schema}
            initial={stageData.stage3}
            onSave={saveStage3}
            onComplete={() => advanceTo(4)}
          />
        );
      case 4:
        return (
          <ChartViewer
            schema={stageData.stage2?.schema}
            stage3={stageData.stage3}
            onComplete={() => advanceTo(5)}
          />
        );
      case 5:
        return (
          <div>
            {banner}
            <ReportViewer
              stage5={stageData.stage5}
              onSave={saveStage5}
              onSubmit={pendingStage5 ? undefined : submitStage5}
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
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      <div className={`bg-white rounded-lg shadow-sm overflow-hidden ${panel ? 'lg:w-1/2' : 'w-full'} min-h-0 flex flex-col`}>
        <ConversationChat
          initialMessages={initialMessages}
          stage={stage}
          send={sendChat}
          onResult={onChatResult}
          onSafetyPassed={markSafetyPassed}
        />
      </div>
      {panel && (
        <div className="bg-white rounded-lg shadow-sm overflow-y-auto lg:w-1/2 min-h-0">
          {panel}
        </div>
      )}
    </div>
  );
}

function SubmitButton({ label, onSubmit }: { label: string; onSubmit: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const click = async () => {
    setBusy(true); setErr(null);
    const e = await onSubmit();
    setBusy(false);
    if (e) setErr(e);
  };
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={click}
        disabled={busy}
        className="px-4 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
      >
        {busy ? '提交中…' : label}
      </button>
      {err && <span className="text-sm text-red-600">{err}</span>}
    </div>
  );
}

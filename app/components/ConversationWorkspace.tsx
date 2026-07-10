"use client";

import React, { useEffect, useRef, useState } from 'react';
import type { Message } from '../models/types';
import type { StageData, Stage3FileAssociation, AssignmentStatus } from '../models/stageData';
import ConversationChat, { type ChatApiResponse } from './ConversationChat';
import DataTableEditor from './DataTableEditor';
import ChartViewer from './ChartViewer';
import ReportViewer from './ReportViewer';
import Stage6Panel from './Stage6Panel';
import SchemaEditor from './SchemaEditor';
import Fireworks from './Fireworks';
import type { Stage2Column } from '../models/stageData';

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
  const [completed, setCompleted] = useState(initialStatus === 'COMPLETED');
  // ConversationChat 注册的程序化发送：消息正常进入聊天流（用户可见 AI 的开场/框架回复）
  const autoSendRef = useRef<((text: string) => Promise<void>) | null>(null);
  const registerAutoSend = (fn: (text: string) => Promise<void>) => {
    autoSendRef.current = fn;
  };

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
    if (data.status) {
      setStatus(data.status);
      if (data.status === 'COMPLETED') setCompleted(true);
    }
    if (typeof data.currentStage === 'number') setStage(data.currentStage);
    return null;
  };

  const submitStage2 = () => postAction('submit-stage2');
  const submitStage5 = () => postAction('submit-stage5');
  const respondStage6 = (response: string) => postAction('stage6-respond', { response });

  /** 保存学生对数据表列定义的修改（阶段2） */
  const saveSchema = async (columns: Stage2Column[]): Promise<string | null> => {
    const res = await fetch(`/api/conversations/${conversationId}/stage-data`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage2: { columns } }),
    });
    const data = await res.json();
    if (!res.ok) return data.error || '保存失败';
    setStageData(data.stageData);
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

  const generateStage5ReportFramework = async (): Promise<string | null> => {
    if (stageData.stage5?.sections) return null;
    // 优先走聊天流（用户可见 AI 的开场回复与"已生成报告框架"提示）
    if (autoSendRef.current) {
      await autoSendRef.current('开始报告成型');
      return null;
    }
    try {
      const res = await fetch(`/api/conversations/${conversationId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '开始报告成型' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.message || data.error || '报告框架生成失败，请稍后重试。';
      if (data.stageData) setStageData(data.stageData);
      return null;
    } catch {
      return '报告框架生成失败，请稍后重试。';
    }
  };

  // 兜底：处于阶段5但报告框架缺失（如生成失败后刷新页面）→ 自动重新触发。
  // 1→2 推进后自动发送承接消息，让 AI 给出方案设计阶段的开场与路线图。
  // 用 effect 监听 stage 变化：确保子组件已重新注册 autoSend（闭包新鲜），且 typing 指示器正常显示。
  const prevStageRef = useRef(initialStage);
  const stage5FallbackFired = useRef(false);
  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = stage;
    if (prev === 1 && stage === 2) {
      void autoSendRef.current?.('我已确认选题，现在开始设计实验方案。');
      return;
    }
    if (stage === 5 && !stageData.stage5?.sections && !stage5FallbackFired.current) {
      stage5FallbackFired.current = true;
      void generateStage5ReportFramework();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const advanceToStage5 = async (): Promise<string | null> => {
    // 进入阶段5后，上方 useEffect 会自动触发报告框架生成
    return advanceTo(5);
  };

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

  /** 阶段完成后的确认推进（直接调 advance 端点，不发 LLM 请求）。
   * 推进后的自动触发消息（1→2 承接、进入5生成报告框架）由监听 stage 变化的 useEffect 统一处理。 */
  const onPhaseConfirm = async (): Promise<string | null> => {
    return advanceTo(stage + 1);
  };

  const pendingStage2 = status === 'PENDING_STAGE2';
  const pendingStage5 = status === 'PENDING_STAGE5';
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
        if (!stageData.stage2?.schema) return null;
        return (
          <div>
            {banner}
            <SchemaEditor
              columns={stageData.stage2.schema.columns}
              onSave={saveSchema}
            />
            {stageData.stage2.aiRiskAnnotations && stageData.stage2.aiRiskAnnotations.length > 0 && (
              <div className="mx-4 mb-3 bg-amber-50 border border-amber-200 rounded p-2 text-sm">
                <div className="font-medium text-amber-800 mb-1">⚠️ 安全/风险提示</div>
                {stageData.stage2.aiRiskAnnotations.map((r, i) => (
                  <div key={i} className="text-amber-700">· {r.description}（{r.severity}）</div>
                ))}
              </div>
            )}
            {!pendingStage2 && (
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
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      <div className={`bg-white rounded-lg shadow-sm overflow-hidden ${panel ? 'lg:w-1/2' : 'w-full'} min-h-0 flex flex-col`}>
        <ConversationChat
          initialMessages={initialMessages}
          stage={stage}
          completed={completed}
          send={sendChat}
          onResult={onChatResult}
          onSafetyPassed={markSafetyPassed}
          onPhaseConfirm={onPhaseConfirm}
          roundCount={stageData.roundCounts?.[stage] ?? 0}
          registerAutoSend={registerAutoSend}
        />
      </div>
      {panel && (
        <div className="bg-white rounded-lg shadow-sm overflow-y-auto lg:w-1/2 min-h-0">
          {panel}
        </div>
      )}
      {completed && <Fireworks />}
    </div>
  );
}

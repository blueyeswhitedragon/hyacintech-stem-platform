"use client";

import React, { useEffect, useRef, useState } from 'react';
import type { StageData, Stage3FileAssociation } from '../models/stageData';
import type { Message } from '../models/types';
import { initialWelcomeMessage } from '../lib/welcome';
import { extractStageData } from '../lib/stageExtraction';
import { canAdvance } from '../lib/stageAdvance';
import { buildPriorSummary } from '../lib/reportSummary';
import ConversationChat, { type ChatApiResponse } from './ConversationChat';
import DataTableEditor from './DataTableEditor';
import ChartViewer from './ChartViewer';
import ReportViewer from './ReportViewer';
import Stage6Panel from './Stage6Panel';
import SchemaEditor from './SchemaEditor';
import Fireworks from './Fireworks';
import type { Stage2Column } from '../models/stageData';

/**
 * 体验模式：无账号、纯内存六阶段。复用正式模式的富组件与纯函数
 * （extractStageData / canAdvance），数据仅存浏览器内存，刷新即丢。
 */
export default function GuestWorkspace() {
  const [welcome] = useState<Message[]>(() => [initialWelcomeMessage()]);
  const [stage, setStage] = useState(1);
  const [stageData, setStageData] = useState<StageData>({});
  const [completed, setCompleted] = useState(false);
  // 进入阶段3后是否还需出安全问答（每次"进入"强制一次）
  const needQuizRef = useRef(true);
  // ConversationChat 注册的程序化发送（自动触发消息正常进入聊天流）
  const autoSendRef = useRef<((text: string) => Promise<void>) | null>(null);
  const registerAutoSend = (fn: (text: string) => Promise<void>) => {
    autoSendRef.current = fn;
  };

  // ConversationChat 注入的发送：打 guest 端点，本地跑结构化提取
  const send = async (message: string, history: Message[]): Promise<ChatApiResponse> => {
    const res = await fetch('/api/guest/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        stage,
        history,
        dataRows: stageData.stage3?.rows,
        needSafetyQuiz: stage === 3 && needQuizRef.current,
        priorSummary: stage === 5 ? buildPriorSummary(stageData) : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || '请求失败，请重试。');

    if (stage === 3 && data.safety_quiz) needQuizRef.current = false;

    // 本地结构化提取（与服务端同源纯函数）
    const { stageData: nextSD, advanceTo } = extractStageData(stage, data, stageData);
    // 阶段4：每发一条消息，分析轮次 +1
    if (stage === 4) {
      nextSD.stage4 = { analysisCount: (stageData.stage4?.analysisCount ?? 0) + 1 };
    }
    const nextStage = advanceTo ?? stage;
    return { ...data, currentStage: nextStage, stageData: nextSD };
  };

  const onChatResult = (data: ChatApiResponse) => {
    if (typeof data.currentStage === 'number') setStage(data.currentStage);
    if (data.stageData) setStageData(data.stageData);
  };

  const advanceLocal = async (to: number): Promise<string | null> => {
    const chk = canAdvance(stage, to, stageData);
    if (!chk.ok) return chk.error ?? '暂不能进入下一阶段';
    if (to === 3) needQuizRef.current = true;
    setStage(to);
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
      const res = await fetch('/api/guest/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '开始报告成型',
          stage: 5,
          history: [],
          needSafetyQuiz: false,
          priorSummary: buildPriorSummary(stageData),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.message || data.error || '报告框架生成失败，请稍后重试。';
      const { stageData: nextSD } = extractStageData(5, data, stageData);
      setStageData(nextSD);
      return null;
    } catch {
      return '报告框架生成失败，请稍后重试。';
    }
  };

  // 阶段推进后的自动触发：1→2 承接开场；进入5生成报告框架（含失败兜底）
  const prevStageRef = useRef(1);
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
    return advanceLocal(5);
  };

  /** 阶段完成后的确认推进（本地直接调 advanceLocal，不发 LLM 请求）。
   * 推进后的自动触发消息由监听 stage 变化的 useEffect 统一处理。 */
  const onPhaseConfirm = async (): Promise<string | null> => {
    return advanceLocal(stage + 1);
  };

  const saveStage3 = async (rows: Record<string, unknown>[], fileAssociations: Stage3FileAssociation[]) => {
    setStageData((prev) => ({ ...prev, stage3: { rows, fileAssociations } }));
    return null;
  };

  const saveStage5 = async (conclusion: string, reflection: string) => {
    setStageData((prev) =>
      prev.stage5
        ? { ...prev, stage5: { ...prev.stage5, sections: { ...prev.stage5.sections, conclusion, reflection } } }
        : prev
    );
    return null;
  };

  // 提交报告（体验）：调 AI 评分 → 写入 → 进阶段6
  const submitStage5 = async (): Promise<string | null> => {
    const sections = stageData.stage5?.sections;
    if (!sections?.conclusion.trim() || !sections?.reflection.trim()) {
      return '请先填写结论与反思';
    }
    try {
      const res = await fetch('/api/guest/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.score) {
        setStageData((prev) => (prev.stage5 ? { ...prev, stage5: { ...prev.stage5, aiReferenceScore: data.score } } : prev));
      }
    } catch {
      // 评分失败不阻断
    }
    setStage(6);
    return null;
  };

  const submitStage2 = async (): Promise<string | null> => {
    needQuizRef.current = true;
    setStage(3);
    return null;
  };

  /** 体验模式：本地保存列定义修改 */
  const saveSchema = async (columns: Stage2Column[]): Promise<string | null> => {
    setStageData((prev) =>
      prev.stage2
        ? { ...prev, stage2: { ...prev.stage2, schema: { ...prev.stage2.schema, columns } } }
        : prev
    );
    return null;
  };

  const respondStage6 = async (response: string): Promise<string | null> => {
    setStageData((prev) => ({ ...prev, stage6: { studentResponse: response, finalReadonly: true } }));
    setCompleted(true);
    return null;
  };

  function renderPanel() {
    switch (stage) {
      case 2:
        if (!stageData.stage2?.schema) return null;
        return (
          <div>
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
            <div className="px-4 pb-4">
              <button
                onClick={() => { submitStage2(); }}
                className="px-4 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600"
              >
                提交方案（体验模式直接进入下一阶段）
              </button>
            </div>
          </div>
        );
      case 3:
        return (
          <DataTableEditor
            schema={stageData.stage2?.schema}
            initial={stageData.stage3}
            onSave={saveStage3}
            onComplete={() => advanceLocal(4)}
            allowUpload={false}
          />
        );
      case 4:
        return <ChartViewer schema={stageData.stage2?.schema} stage3={stageData.stage3} onComplete={advanceToStage5} />;
      case 5:
        return <ReportViewer stage5={stageData.stage5} schemaColumns={stageData.stage2?.schema?.columns} dataRows={stageData.stage3?.rows} onSave={saveStage5} onSubmit={submitStage5} />;
      case 6:
        return <Stage6Panel stage5={stageData.stage5} stage6={stageData.stage6} completed={completed} onSubmit={respondStage6} guestMode />;
      default:
        return null;
    }
  }

  const panel = renderPanel();

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      <div className={`bg-white rounded-lg shadow-sm overflow-hidden ${panel ? 'lg:w-1/2' : 'w-full'} min-h-0 flex flex-col`}>
        <ConversationChat initialMessages={welcome} stage={stage} completed={completed} send={send} onResult={onChatResult} onPhaseConfirm={onPhaseConfirm} registerAutoSend={registerAutoSend} />
      </div>
      {panel && <div className="bg-white rounded-lg shadow-sm overflow-y-auto lg:w-1/2 min-h-0">{panel}</div>}
      {completed && <Fireworks />}
    </div>
  );
}

"use client";

import React, { useRef, useState } from 'react';
import type { StageData, Stage3FileAssociation } from '../models/stageData';
import type { Message } from '../models/types';
import { initialWelcomeMessage } from '../lib/welcome';
import { extractStageData } from '../lib/stageExtraction';
import { canAdvance } from '../lib/stageAdvance';
import ConversationChat, { type ChatApiResponse } from './ConversationChat';
import DataTableEditor from './DataTableEditor';
import ChartViewer from './ChartViewer';
import ReportViewer from './ReportViewer';
import Stage6Panel from './Stage6Panel';

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
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || '请求失败，请重试。');

    if (stage === 3 && data.safety_quiz) needQuizRef.current = false;

    // 本地结构化提取（与服务端同源纯函数）
    const { stageData: nextSD, advanceTo } = extractStageData(stage, data, stageData);
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
          <div className="p-4">
            <h3 className="font-medium mb-2">数据表结构预览</h3>
            <ul className="text-sm text-gray-700 list-disc pl-5 mb-3">
              {stageData.stage2.schema.columns.map((c) => (
                <li key={c.key}>{c.title}（{c.type}）{c.required && <span className="text-red-500">必填</span>}</li>
              ))}
            </ul>
            <button onClick={submitStage2} className="px-4 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600">
              提交方案（体验模式直接进入下一阶段）
            </button>
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
        return <ChartViewer schema={stageData.stage2?.schema} stage3={stageData.stage3} onComplete={() => advanceLocal(5)} />;
      case 5:
        return <ReportViewer stage5={stageData.stage5} onSave={saveStage5} onSubmit={submitStage5} />;
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
        <ConversationChat initialMessages={welcome} stage={stage} send={send} onResult={onChatResult} />
      </div>
      {panel && <div className="bg-white rounded-lg shadow-sm overflow-y-auto lg:w-1/2 min-h-0">{panel}</div>}
    </div>
  );
}

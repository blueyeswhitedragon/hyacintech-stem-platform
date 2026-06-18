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
import SchemaEditor from './SchemaEditor';
import Fireworks from './Fireworks';
import SubmitButton from './SubmitButton';
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

  /** 阶段完成后的确认推进（本地直接调 advanceLocal，不发 LLM 请求） */
  const onPhaseConfirm = async (): Promise<string | null> => {
    const err = await advanceLocal(stage + 1);
    if (err) return err;
    // 进入阶段5时自动触发报告框架生成
    if (stage + 1 === 5 && !stageData.stage5?.sections) {
      setTimeout(async () => {
        try {
          const res = await fetch('/api/guest/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: '开始报告成型', stage: 5, history: [], needSafetyQuiz: false }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.stageData) setStageData(data.stageData);
          if (res.ok && data.report_sections) {
            setStageData((prev) => ({
              ...prev,
              stage5: {
                submitted: false,
                approved: null,
                sections: {
                  ...data.report_sections,
                  conclusion: '',
                  reflection: '',
                },
              },
            }));
          }
        } catch { /* 不阻断 */ }
      }, 500);
    }
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
              <SubmitButton label="提交方案（体验模式直接进入下一阶段）" variant="success" onSubmit={submitStage2} />
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
        return <ChartViewer schema={stageData.stage2?.schema} stage3={stageData.stage3} onComplete={() => advanceLocal(5)} />;
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
        <ConversationChat initialMessages={welcome} stage={stage} completed={completed} send={send} onResult={onChatResult} onPhaseConfirm={onPhaseConfirm} />
      </div>
      {panel && <div className="bg-white rounded-lg shadow-sm overflow-y-auto lg:w-1/2 min-h-0">{panel}</div>}
      {completed && <Fireworks />}
    </div>
  );
}

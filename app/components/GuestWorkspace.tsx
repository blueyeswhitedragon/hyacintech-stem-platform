"use client";

import React, { useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
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
import { buildAssistantTransitionMessage, buildStage4TransitionResult } from '../lib/stageTransition';

/**
 * 体验模式：无账号、纯内存六阶段。复用正式模式的富组件与纯函数
 * （extractStageData / canAdvance），数据仅存浏览器内存，刷新即丢。
 */
export default function GuestWorkspace() {
  const [welcome] = useState<Message[]>(() => [initialWelcomeMessage()]);
  const [stage, setStage] = useState(1);
  const [stageData, setStageData] = useState<StageData>({});
  const stageDataRef = useRef<StageData>({});
  const [completed, setCompleted] = useState(false);
  const [injectedMessage, setInjectedMessage] = useState<Message | null>(null);
  // 进入阶段3后是否还需出安全问答；只有答对后才关闭。
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
        dataSchema: stageData.stage2?.schema,
        stageData,
        needSafetyQuiz: stage === 3 && needQuizRef.current,
        priorSummary: [3, 5, 6].includes(stage) ? buildPriorSummary(stageData) : undefined,
        hasStage2Schema: (stageData.stage2?.schema.columns.length ?? 0) > 0,
        triggerType: stage === 3 && needQuizRef.current
          ? 'STAGE_ENTER'
          : stage === 5 && !stageData.stage5?.sections
            ? 'REPORT_BOOTSTRAP'
            : stage === 6
              ? 'OPTIONAL_COACHING'
              : 'USER_MESSAGE',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || '请求失败，请重试。');

    // tutor-language-v1 由服务端拥有结构化状态；旧响应仍保留本地兼容提取。
    if (data.stageData) return data as ChatApiResponse;
    const { stageData: nextSD, advanceTo } = extractStageData(stage, data, stageData, {
      studentMessage: message,
      dataRows: stageData.stage3?.rows ?? [],
    });
    const nextStage = advanceTo ?? stage;
    return { ...data, currentStage: nextStage, stageData: nextSD };
  };

  const onChatResult = (data: ChatApiResponse) => {
    if (typeof data.currentStage === 'number') setStage(data.currentStage);
    if (data.stageData) {
      stageDataRef.current = data.stageData;
      setStageData(data.stageData);
    }
  };

  const advanceLocal = async (to: number): Promise<string | null> => {
    const currentData = stageDataRef.current;
    const chk = canAdvance(stage, to, currentData, {
      safetyQuizCompleted: currentData.stage3?.safetyQuiz?.passed === true,
    });
    if (!chk.ok) return chk.error ?? '暂不能进入下一阶段';

    if (stage === 1 && to === 2) {
      try {
        const priorSummary = buildPriorSummary(currentData);
        const res = await fetch('/api/guest/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: '系统触发：学生已确认选题。请发送阶段2方案设计的开场，只推进第一个方案缺口。',
            stage: 2,
            history: [],
            stageData: currentData,
            priorSummary,
            triggerType: 'STAGE_TRANSITION',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data.message || data.error || '方案设计引导生成失败，请重试';
        setInjectedMessage(buildAssistantTransitionMessage(data, uuidv4()));
        setStage(2);
        return null;
      } catch {
        return '方案设计引导生成失败，请重试';
      }
    }

    if (stage === 3 && to === 4) {
      try {
        const res = await fetch('/api/guest/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: '系统触发：学生已完成数据收集。请读取已提交的数据表，并发送阶段4的数据分析开场。',
            stage: 4,
            history: [],
            dataRows: currentData.stage3?.rows ?? [],
            dataSchema: currentData.stage2?.schema,
            stageData: currentData,
            hasStage2Schema: true,
            triggerType: 'STAGE_TRANSITION',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data.message || data.error || '分析引导生成失败，请重试';
        const { stageData: nextData, transitionMessage } = buildStage4TransitionResult(
          currentData,
          data,
          uuidv4(),
        );
        stageDataRef.current = nextData;
        setStageData(nextData);
        setInjectedMessage(transitionMessage);
        setStage(4);
        return null;
      } catch {
        return '分析引导生成失败，请重试';
      }
    }

    if (stage === 4 && to === 5) {
      try {
        const priorSummary = buildPriorSummary(currentData);
        const res = await fetch('/api/guest/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: '系统触发：学生已完成数据分析。请依据前序结构化状态生成阶段5报告框架。',
            stage: 5,
            history: [],
            stageData: currentData,
            priorSummary,
            triggerType: 'REPORT_BOOTSTRAP',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return data.message || data.error || '报告框架生成失败，请重试';
        const { stageData: nextData } = extractStageData(5, data, currentData);
        stageDataRef.current = nextData;
        setStageData(nextData);
        setInjectedMessage(buildAssistantTransitionMessage(data, uuidv4()));
        setStage(5);
        return null;
      } catch {
        return '报告框架生成失败，请重试';
      }
    }

    if (to === 3) needQuizRef.current = true;
    setStage(to);
    return null;
  };

  const advanceToStage5 = async (): Promise<string | null> => advanceLocal(5);

  /** 阶段完成后的确认推进；系统过渡通过 guest API 生成助手主动消息。 */
  const onPhaseConfirm = async (): Promise<string | null> => {
    return advanceLocal(stage + 1);
  };

  const saveStage3 = async (rows: Record<string, unknown>[], fileAssociations: Stage3FileAssociation[]) => {
    if (stageDataRef.current.stage3?.safetyQuiz?.passed !== true) {
      return '请先完成并通过本实验的安全问答，再录入数据';
    }
    const nextData = { ...stageDataRef.current, stage3: { ...stageDataRef.current.stage3, rows, fileAssociations } };
    stageDataRef.current = nextData;
    setStageData(nextData);
    return null;
  };

  const markGuestSafetyPassed = async (selected: number) => {
    const previous = stageDataRef.current;
    const quiz = previous.stage3?.safetyQuiz;
    if (!quiz || selected !== quiz.correct) throw new Error('安全问答答案无效');
    const nextData: StageData = {
      ...previous,
      stage3: {
        ...(previous.stage3 ?? { rows: [] }),
        safetyQuiz: { ...quiz, selected, passed: true },
      },
    };
    needQuizRef.current = false;
    stageDataRef.current = nextData;
    setStageData(nextData);
  };

  const saveStage5 = async (conclusion: string, reflection: string) => {
    const previous = stageDataRef.current;
    if (!previous.stage5) return '报告框架尚未生成';
    const nextData: StageData = {
      ...previous,
      stage5: { ...previous.stage5, sections: { ...previous.stage5.sections, conclusion, reflection } },
    };
    stageDataRef.current = nextData;
    setStageData(nextData);
    return null;
  };

  // 提交报告（体验）：调 AI 评分 → 写入 → 进阶段6
  const submitStage5 = async (): Promise<string | null> => {
    const sections = stageDataRef.current.stage5?.sections;
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
        const previous = stageDataRef.current;
        if (previous.stage5) {
          const nextData: StageData = { ...previous, stage5: { ...previous.stage5, aiReferenceScore: data.score } };
          stageDataRef.current = nextData;
          setStageData(nextData);
        }
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
    const previous = stageDataRef.current;
    if (!previous.stage2) return '当前没有可编辑的数据表结构';
    const nextData: StageData = {
      ...previous,
      stage2: { ...previous.stage2, schema: { ...previous.stage2.schema, columns } },
    };
    stageDataRef.current = nextData;
    setStageData(nextData);
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
            disabledReason={stageData.stage3?.safetyQuiz?.passed === true ? undefined : '请先在左侧完成安全问答，答对后才能录入实验数据。'}
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
        <ConversationChat initialMessages={welcome} stage={stage} completed={completed} send={send} onResult={onChatResult} onSafetyPassed={markGuestSafetyPassed} onPhaseConfirm={onPhaseConfirm} injectedMessage={injectedMessage} />
      </div>
      {panel && <div className="bg-white rounded-lg shadow-sm overflow-y-auto lg:w-1/2 min-h-0">{panel}</div>}
      {completed && <Fireworks />}
    </div>
  );
}

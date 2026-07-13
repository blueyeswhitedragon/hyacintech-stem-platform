"use client";

import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ChatResponse, SafetyQuiz } from '../models/types';
import type { StageData } from '../models/stageData';
import MessageItem from './MessageItem';
import StageProgress from './StageProgress';
import { shouldShowEscapeHatch } from '../lib/pacing';
import { injectMessageOnce } from '../lib/messageInjection';

/** 逃生按钮发送的强制收敛消息：促使模型立即输出确认书（仍由模型产出结构化信号，不绕过 gating）。 */
const FORCE_CONVERGE_TEXT = '我觉得讨论得差不多了，请你直接给出《探究问题确认书》，让我进入下一阶段。';

export interface ChatApiResponse extends ChatResponse {
  currentStage?: number;
  stageData?: StageData;
}

interface Props {
  initialMessages: Message[];
  stage: number;
  /** 整个探究是否已全部完成（六阶段都结束）。 */
  completed?: boolean;
  /** 发送消息（带当前历史）→ 返回（可能已补充 currentStage/stageData 的）ChatApiResponse。 */
  send: (message: string, history: Message[]) => Promise<ChatApiResponse>;
  /** 每次 chat 响应后回调，供 workspace 更新 stage / stageData。 */
  onResult?: (data: ChatApiResponse) => void;
  /** 安全问答答对后的回调（正式模式 POST safety-quiz；体验模式本地无操作）。 */
  onSafetyPassed?: () => void | Promise<void>;
  /** 当阶段完成且用户点击"确认"时，直接推进阶段（不再发 LLM 请求）。 */
  onPhaseConfirm?: () => Promise<string | null>;
  /** 本阶段累计对话轮次，用于判断是否显示「我已准备好，进入下一步」逃生按钮。 */
  roundCount?: number;
  /** 服务端或父级生成的助手主动消息；按稳定 id 去重注入，不产生用户消息。 */
  injectedMessage?: Message | null;
}

const noop = () => {};

// 把结构化产出转成一条轻提示文本（数据表结构 / 报告框架）
function structuredNotice(data: ChatApiResponse): string | null {
  if (data.data_table_schema) {
    const n = data.data_table_schema.columns.length;
    return `✅ 已生成实验数据表结构（共 ${n} 列），将在「过程执行」阶段用于录入数据。`;
  }
  if (data.report_sections) {
    return '✅ 已生成报告框架（目的/假设/材料/步骤/数据/分析已预填），请补充结论与反思。';
  }
  return null;
}

export default function ConversationChat({ initialMessages, stage, completed, send, onResult, onSafetyPassed, onPhaseConfirm, roundCount = 0, injectedMessage }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<SafetyQuiz | null>(null);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [hintsEnabled, setHintsEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 并发发送守卫：用 ref 而非 isLoading，确保确认按钮流程中（isLoading=true）仍可执行自动触发消息
  const sendingRef = useRef(false);
  const displayedMessages = injectMessageOnce(messages, injectedMessage);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, injectedMessage, isLoading]);

  const doSend = async (text: string) => {
    if (text.trim() === '' || sendingRef.current) return;
    sendingRef.current = true;

    const userMessage: Message = { id: uuidv4(), role: 'user', content: text, status: 'sent' };
    const historyForSend = displayedMessages;
    setMessages([...historyForSend, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      let data: ChatApiResponse;
      try {
        data = await send(text, historyForSend);
      } catch (e) {
        setError(e instanceof Error ? e.message : '请求失败，请重试。');
        setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
        return;
      }

      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: data.dialogue,
        options: data.options,
        hints: data.hints,
        actionType: data.next_action_type,
        phaseComplete: data.phase_complete,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      onResult?.(data);

      // 结构化产出：阶段确认书 → 独立卡片消息
      if (data.stage1_confirmed && data.snapshot) {
        setMessages((prev) => [
          ...prev,
          {
            id: uuidv4(),
            role: 'assistant',
            content: data.snapshot!,
            messageType: 'confirmation_doc' as const,
          },
        ]);
      }
      // 安全问答 → 弹内联小测
      if (data.safety_quiz) {
        setQuiz(data.safety_quiz);
        setQuizChoice(null);
        setQuizError(null);
      }
      const notice = structuredNotice(data);
      if (notice) {
        setMessages((prev) => [
          ...prev,
          { id: uuidv4(), role: 'assistant', content: notice },
        ]);
      }
    } catch {
      setError('发送消息失败，请重试');
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      sendingRef.current = false;
      setIsLoading(false);
    }
  };

  const sendMessage = () => doSend(inputValue);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /** 选项/提示仅展示，不发送 —— 引导学生思考方向而非代答 */
  // handleOptionClick removed — options are display-only

  /** 确认按钮：始终直接推进阶段，不作为对话输入 */
  const handleConfirm = async () => {
    if (!onPhaseConfirm) return;
    setIsLoading(true);
    setError(null);
    const err = await onPhaseConfirm();
    setIsLoading(false);
    if (err) setError(err);
  };

  const submitQuiz = async () => {
    if (!quiz || quizChoice === null) return;
    if (quizChoice !== quiz.correct) {
      setQuizError('回答不正确，请再想一想安全要点后重新选择。');
      return;
    }
    // 答对 → 通知调用方（正式模式 POST safety-quiz；体验模式无操作）
    try {
      await onSafetyPassed?.();
    } catch {
      // 标记失败不阻断；下次进入会重新出题
    }
    setQuiz(null);
    setMessages((prev) => [
      ...prev,
      { id: uuidv4(), role: 'assistant', content: '✅ 安全问答通过，可以开始记录实验数据了。' },
    ]);
  };

  // 最后一条助手消息的交互类型/选项/提示
  // 注意：confirmation_doc 等特殊消息可能没有 actionType，需要向前查找
  const assistantMessages = displayedMessages.filter((m) => m.role === 'assistant');
  const lastWithAction = [...assistantMessages].reverse().find(m => m.actionType);
  const lastActionType = lastWithAction?.actionType ?? null;
  const options =
    stage !== 1 && hintsEnabled && lastActionType === 'ask_choice' && lastWithAction?.options?.length ? lastWithAction.options : null;
  const hints =
    hintsEnabled && lastWithAction?.hints?.length ? lastWithAction.hints : null;

  // 确认按钮与确认书卡片绑定：若最近一条 confirmation_doc 在 confirmation 动作之后出现，
  // 则按钮直接渲染在该卡片下方（同一视觉块）；否则退回底部固定条（阶段3/4等无卡片场景）。
  const lastDocIndex = displayedMessages.reduce(
    (acc, m, i) => (m.messageType === 'confirmation_doc' ? i : acc), -1);
  const confirmAttachedToDoc = lastActionType === 'confirmation' && lastDocIndex === displayedMessages.length - 1;

  const confirmButton = (
    <button
      onClick={handleConfirm}
      disabled={isLoading}
      className="px-6 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50 text-lg font-medium"
    >
      {isLoading ? '处理中…' : '确认，进入下一阶段'}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-white p-4">
        <StageProgress currentStage={stage} completed={completed} />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {displayedMessages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            isLastUser={false}
            onResend={noop}
            onEdit={noop}
          />
        ))}
        {/* 确认书卡片存在时，确认按钮紧跟卡片渲染在消息流内（同一视觉块） */}
        {confirmAttachedToDoc && (
          <div className="mb-4 -mt-2 text-left">{confirmButton}</div>
        )}
        {isLoading && (
          <div className="text-left mb-4">
            <div className="inline-block rounded-lg px-4 py-2 bg-gray-100 text-gray-800">
              <div className="flex items-center">
                <div className="dot-typing"></div>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="text-center mb-4">
            <div className="inline-block rounded-lg px-4 py-2 bg-red-100 text-red-800">{error}</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 思考线索区域（可开关，仅展示不互动） */}
      {hints && hints.length > 0 && (
        <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-amber-800 font-medium">
              {stage === 1 ? '思考线索' : '思维提示'}
            </span>
          </div>
          <div className="space-y-1.5">
            {hints.map((hint, index) => (
              <div
                key={index}
                className="rounded-md border border-amber-200 border-l-4 border-l-amber-400 bg-white px-3 py-2 text-sm text-amber-950"
              >
                <span className="mr-2 text-xs font-medium text-amber-700">
                  {stage === 1 ? `线索${index + 1}` : `提示${index + 1}`}
                </span>
                <span>{hint}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {options && options.length > 0 && (
        <div className="p-4 bg-gray-50">
          <div className="flex flex-wrap gap-2 justify-center">
            {options.map((option, index) => (
              <span
                key={index}
                className="px-4 py-2 bg-blue-50 text-blue-700 rounded-md border border-blue-200 text-sm"
              >
                {option}
              </span>
            ))}
          </div>
        </div>
      )}

      {lastActionType === 'confirmation' && !confirmAttachedToDoc && (
        <div className="p-4 bg-gray-50 flex justify-center">
          {confirmButton}
        </div>
      )}

      {/* 逃生按钮：轮次过多且当前没有确认按钮时出现。发送强制收敛消息促使模型给出确认书。 */}
      {lastActionType !== 'confirmation' && !quiz && shouldShowEscapeHatch(stage, roundCount) && (
        <div className="px-4 pt-3 flex justify-center">
          <button
            onClick={() => doSend(FORCE_CONVERGE_TEXT)}
            disabled={isLoading}
            className="px-4 py-1.5 text-sm bg-white border border-green-400 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-50"
          >
            讨论得差不多了？让我进入下一步 →
          </button>
        </div>
      )}

      {quiz && (
        <div className="p-4 bg-amber-50 border-t border-amber-200">
          <div className="font-medium text-amber-800 mb-2">⚠️ 安全问答（答对后才能继续）</div>
          <div className="text-gray-800 mb-2">{quiz.question}</div>
          <div className="space-y-1 mb-2">
            {quiz.options.map((opt, i) => (
              <label key={i} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="safety-quiz"
                  checked={quizChoice === i}
                  onChange={() => { setQuizChoice(i); setQuizError(null); }}
                />
                {opt}
              </label>
            ))}
          </div>
          {quizError && <div className="text-sm text-red-600 mb-2">{quizError}</div>}
          <button
            onClick={submitQuiz}
            disabled={quizChoice === null}
            className="px-4 py-1.5 bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50 text-sm"
          >
            提交答案
          </button>
        </div>
      )}

      <div className="border-t p-4 bg-white">
        {/* 提示开关：控制思维提示(hints)和非阶段1选择项(options)的显示 */}
        <div className="flex items-center justify-end mb-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
            <span>提示</span>
            <button
              type="button"
              role="switch"
              aria-checked={hintsEnabled}
              onClick={() => setHintsEnabled(!hintsEnabled)}
              className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
                hintsEnabled ? 'bg-yellow-400' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  hintsEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        </div>
        <div className="flex">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={quiz ? '请先完成上方安全问答…' : '输入你的问题或回答...'}
            className="flex-1 resize-none border rounded-l-lg p-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            rows={2}
            disabled={isLoading || quiz !== null}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || quiz !== null || inputValue.trim() === ''}
            className="px-4 py-2 bg-blue-500 text-white rounded-r-lg hover:bg-blue-600 disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </div>

      <style jsx>{`
        .dot-typing {
          position: relative;
          left: -9999px;
          width: 6px;
          height: 6px;
          border-radius: 3px;
          background-color: #9880ff;
          color: #9880ff;
          box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff;
          animation: dot-typing 1.5s infinite linear;
        }
        @keyframes dot-typing {
          0% { box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff; }
          16.667% { box-shadow: 9984px -6px 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff; }
          33.333% { box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff; }
          50% { box-shadow: 9984px 0 0 0 #9880ff, 9999px -6px 0 0 #9880ff, 10014px 0 0 0 #9880ff; }
          66.667% { box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff; }
          83.333% { box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px -6px 0 0 #9880ff; }
          100% { box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff; }
        }
      `}</style>
    </div>
  );
}

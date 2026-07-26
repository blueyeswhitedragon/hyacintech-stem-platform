"use client";

import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ChatResponse, SafetyQuiz } from '../models/types';
import type { StageData } from '../models/stageData';
import type { AdvanceHint } from '../lib/advanceHint';
import MessageItem from './MessageItem';
import StageProgress from './StageProgress';
import { shouldShowEscapeHatch } from '../lib/pacing';
import { injectMessageOnce } from '../lib/messageInjection';
import { phaseConfirmationAction } from '../lib/confirmationFlow';
import Button from './ui/Button';
import Callout from './ui/Callout';
import { Textarea } from './ui/Field';

/** 逃生按钮发送的强制收敛消息：促使模型核对研究问题，不绕过服务器门禁。 */
const FORCE_CONVERGE_TEXT = '我觉得研究问题已经清楚了，请直接让我核对并确认这个问题。';
const EXPLICIT_PHASE_CONFIRM_TEXT = '我确认按这个问题做。';

export interface ChatApiResponse extends ChatResponse {
  currentStage?: number;
  stageData?: StageData;
  advanceHint?: AdvanceHint;
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
  onSafetyPassed?: (selected: number) => void | Promise<void>;
  /** 用户确认完成后推进阶段；未形成确认书时组件会先通过 send 写入显式确认。 */
  onPhaseConfirm?: () => Promise<string | null>;
  phaseConfirmLabel?: string;
  /** 本阶段累计对话轮次，用于判断是否显示「我已准备好，进入下一步」逃生按钮。 */
  roundCount?: number;
  /** 服务端或父级生成的助手主动消息；按稳定 id 去重注入，不产生用户消息。 */
  injectedMessage?: Message | null;
  /** 从服务器状态恢复的未完成安全题（不含答案键）。 */
  initialSafetyQuiz?: SafetyQuiz | null;
  /** 待审/已完成时由父级给出只读原因。 */
  readOnlyReason?: string;
  /** 服务端用 canAdvance 计算出的权威推进状态。 */
  advanceReady?: boolean;
  advanceReason?: string;
}

const noop = () => {};

// 把结构化产出转成一条轻提示文本（数据表结构 / 报告框架）
function structuredNotice(data: ChatApiResponse): string | null {
  if (data.data_table_schema) {
    const n = data.data_table_schema.columns.length;
    return `✅ 已生成实验数据表结构（共 ${n} 列），将在「过程执行」阶段用于录入数据。`;
  }
  if (data.report_sections) {
    return '已生成报告框架（目的、假设、材料、步骤、数据和分析已预填），请补充结论与局限讨论。';
  }
  return null;
}

export default function ConversationChat({ initialMessages, stage, completed, send, onResult, onSafetyPassed, onPhaseConfirm, phaseConfirmLabel = '确认，进入下一阶段', roundCount = 0, injectedMessage, initialSafetyQuiz = null, readOnlyReason, advanceReady = false, advanceReason }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<SafetyQuiz | null>(initialSafetyQuiz);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [hintsEnabled, setHintsEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 并发发送守卫：用 ref 而非 isLoading，确保确认按钮流程中（isLoading=true）仍可执行自动触发消息
  const sendingRef = useRef(false);
  const confirmingRef = useRef(false);
  const displayedMessages = injectMessageOnce(messages, injectedMessage);
  const initialSafetyQuizSignature = initialSafetyQuiz ? JSON.stringify(initialSafetyQuiz) : '';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, injectedMessage, isLoading]);

  useEffect(() => {
    if (!initialSafetyQuizSignature) return;
    const restoredQuiz = JSON.parse(initialSafetyQuizSignature) as SafetyQuiz;
    const timer = window.setTimeout(() => {
      setQuiz(restoredQuiz);
      setQuizChoice(null);
      setQuizError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialSafetyQuizSignature]);

  const doSend = async (text: string): Promise<ChatApiResponse | null> => {
    if (text.trim() === '' || sendingRef.current || readOnlyReason) return null;
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
        return null;
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

      // 结构化产出：底层仍保留 snapshot，学生端渲染为紧凑确认状态。
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
      return data;
    } catch {
      setError('发送消息失败，请重试');
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      return null;
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

  /** 未形成确认书时先记录学生确认；确认落库后再推进阶段。 */
  const handleConfirm = async () => {
    if (!onPhaseConfirm || (!advanceReady && !confirmationAction) || confirmingRef.current || readOnlyReason) return;
    confirmingRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      if (!advanceReady && confirmationAction === 'CONFIRM_AND_ADVANCE') {
        const confirmation = await doSend(EXPLICIT_PHASE_CONFIRM_TEXT);
        if (!confirmation) return;
        // 历史合同可能仍由聊天回合直接推进；不要再重复调用 /advance。
        if (typeof confirmation.currentStage === 'number' && confirmation.currentStage > stage) return;
        if (confirmation.stage1_confirmed !== true || confirmation.phase_complete !== true) {
          setError('研究问题尚未完成确认，请根据导师提示补充后再确认。');
          return;
        }
        setIsLoading(true);
      }
      const err = await onPhaseConfirm();
      if (err) setError(err);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '推进失败，请重试');
    } finally {
      confirmingRef.current = false;
      setIsLoading(false);
    }
  };

  const submitQuiz = async () => {
    if (!quiz || quizChoice === null) return;
    // 只提交选择；正式模式由服务器持有答案键并判断正确性。
    try {
      await onSafetyPassed?.(quizChoice);
    } catch (error) {
      setQuizError(error instanceof Error ? error.message : '安全问答提交失败，请重试。');
      return;
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
  const confirmationAction = onPhaseConfirm
    ? phaseConfirmationAction(stage, lastActionType ?? undefined, lastWithAction?.phaseComplete)
    : null;
  const canConfirmPhase = Boolean(onPhaseConfirm && (advanceReady || confirmationAction !== null));
  const options =
    stage !== 1 && hintsEnabled && lastActionType === 'ask_choice' && lastWithAction?.options?.length ? lastWithAction.options : null;
  const hints =
    hintsEnabled && lastWithAction?.hints?.length ? lastWithAction.hints : null;

  // 确认按钮与确认书卡片绑定：若最近一条 confirmation_doc 在 confirmation 动作之后出现，
  // 则按钮直接渲染在该卡片下方（同一视觉块）；否则退回底部固定条（阶段3/4等无卡片场景）。
  const lastDocIndex = displayedMessages.reduce(
    (acc, m, i) => (m.messageType === 'confirmation_doc' ? i : acc), -1);
  const confirmAttachedToDoc = canConfirmPhase && lastDocIndex === displayedMessages.length - 1;

  const confirmButton = (
    <Button
      variant="primary"
      onClick={handleConfirm}
      disabled={Boolean(readOnlyReason) || isLoading}
    >
      {isLoading
        ? '处理中…'
        : !advanceReady && confirmationAction === 'CONFIRM_AND_ADVANCE'
          ? '方向无误，确认并进入方案设计'
          : phaseConfirmLabel}
    </Button>
  );

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="border-b border-hairline bg-canvas p-4">
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
        {/* 确认状态存在时，确认按钮紧跟状态渲染。 */}
        {confirmAttachedToDoc && (
          <div className="-mt-2 mb-4 text-left">{confirmButton}</div>
        )}
        {isLoading && (
          <div className="mb-4 text-left">
            <div className="inline-block rounded-lg border border-hairline bg-surface-soft px-4 py-3">
              <div className="flex items-center">
                <div className="dot-typing"></div>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="mb-4">
            <Callout tone="error">{error}</Callout>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 思考线索区域（可开关，仅展示不互动） */}
      {hints && hints.length > 0 && (
        <div className="border-t border-hairline bg-surface-soft px-4 py-3">
          <span className="caption-upper">{stage === 1 ? '思考线索' : '思维提示'}</span>
          {/* 左侧珊瑚竖线：这是"提示"而非"指令"，靠一笔颜色区分，不整块上色 */}
          <div className="mt-1.5 rounded-md border border-hairline border-l-2 border-l-coral bg-canvas px-3 py-2 text-sm leading-6 text-body">
            {hints[0]}
          </div>
        </div>
      )}

      {options && options.length > 0 && (
        <div className="border-t border-hairline bg-surface-soft p-4">
          <div className="flex flex-wrap justify-center gap-2">
            {options.map((option, index) => (
              <span
                key={index}
                className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-body"
              >
                {option}
              </span>
            ))}
          </div>
        </div>
      )}

      {canConfirmPhase && !confirmAttachedToDoc && (
        <div className="flex justify-center border-t border-hairline bg-surface-soft p-4">
          {confirmButton}
        </div>
      )}

      {readOnlyReason && (
        <div className="border-t border-hairline bg-surface-soft px-4 py-3 text-sm text-muted">
          {readOnlyReason}
        </div>
      )}

      {/* 逃生按钮：轮次过多且当前没有确认按钮时出现。发送强制收敛消息促使模型给出确认书。 */}
      {!canConfirmPhase && !quiz && shouldShowEscapeHatch(stage, roundCount) && (
        <div className="px-4 pt-3 text-center">
          <Button size="sm" onClick={() => doSend(FORCE_CONVERGE_TEXT)} disabled={isLoading}>
            讨论得差不多了？让我进入下一步 →
          </Button>
          {advanceReason && <p className="mt-1 text-xs text-muted">{advanceReason}</p>}
        </div>
      )}

      {quiz && (
        <div className="border-t border-warning/40 bg-warning/8 p-4">
          <div className="mb-2 font-medium text-ink">安全问答（答对后才能继续）</div>
          <div className="mb-2 text-body">{quiz.question}</div>
          <div className="mb-3 space-y-1">
            {quiz.options.map((opt, i) => (
              <label key={i} className="flex cursor-pointer items-center gap-2 text-sm text-body">
                <input
                  type="radio"
                  name="safety-quiz"
                  className="accent-coral"
                  checked={quizChoice === i}
                  onChange={() => { setQuizChoice(i); setQuizError(null); }}
                />
                {opt}
              </label>
            ))}
          </div>
          {quizError && <div className="mb-2 text-sm text-error">{quizError}</div>}
          <Button size="sm" variant="primary" onClick={submitQuiz} disabled={quizChoice === null}>
            提交答案
          </Button>
        </div>
      )}

      <div className="border-t border-hairline bg-canvas p-4">
        {/* 提示开关：控制思维提示(hints)和非阶段1选择项(options)的显示 */}
        <div className="mb-2 flex items-center justify-end">
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted">
            <span>提示</span>
            <button
              type="button"
              role="switch"
              aria-checked={hintsEnabled}
              onClick={() => setHintsEnabled(!hintsEnabled)}
              className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors duration-[120ms] ${
                hintsEnabled ? 'bg-coral' : 'bg-hairline'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-canvas transition-transform ${
                  hintsEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={readOnlyReason ?? (quiz ? '请先完成上方安全问答…' : '输入你的问题或回答...')}
            className="flex-1 resize-none"
            rows={2}
            disabled={Boolean(readOnlyReason) || isLoading || quiz !== null}
          />
          <Button
            variant="primary"
            onClick={sendMessage}
            disabled={Boolean(readOnlyReason) || isLoading || quiz !== null || inputValue.trim() === ''}
          >
            发送
          </Button>
        </div>
      </div>

      <style jsx>{`
        .dot-typing {
          position: relative;
          left: -9999px;
          width: 6px;
          height: 6px;
          border-radius: 3px;
          background-color: #cc785c;
          color: #cc785c;
          box-shadow: 9984px 0 0 0 #cc785c, 9999px 0 0 0 #cc785c, 10014px 0 0 0 #cc785c;
          animation: dot-typing 1.5s infinite linear;
        }
        @keyframes dot-typing {
          0% { box-shadow: 9984px 0 0 0 #cc785c, 9999px 0 0 0 #cc785c, 10014px 0 0 0 #cc785c; }
          16.667% { box-shadow: 9984px -6px 0 0 #cc785c, 9999px 0 0 0 #cc785c, 10014px 0 0 0 #cc785c; }
          33.333% { box-shadow: 9984px 0 0 0 #cc785c, 9999px 0 0 0 #cc785c, 10014px 0 0 0 #cc785c; }
          50% { box-shadow: 9984px 0 0 0 #cc785c, 9999px -6px 0 0 #cc785c, 10014px 0 0 0 #cc785c; }
          66.667% { box-shadow: 9984px 0 0 0 #cc785c, 9999px 0 0 0 #cc785c, 10014px 0 0 0 #cc785c; }
          83.333% { box-shadow: 9984px 0 0 0 #cc785c, 9999px 0 0 0 #cc785c, 10014px -6px 0 0 #cc785c; }
          100% { box-shadow: 9984px 0 0 0 #cc785c, 9999px 0 0 0 #cc785c, 10014px 0 0 0 #cc785c; }
        }
        @media (prefers-reduced-motion: reduce) {
          .dot-typing { animation: none; }
        }
      `}</style>
    </div>
  );
}

"use client";

import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ChatResponse, SafetyQuiz } from '../models/types';
import type { StageData } from '../models/stageData';
import MessageItem from './MessageItem';
import StageProgress from './StageProgress';

export interface ChatApiResponse extends ChatResponse {
  currentStage?: number;
  stageData?: StageData;
}

interface Props {
  initialMessages: Message[];
  stage: number;
  /** 发送消息（带当前历史）→ 返回（可能已补充 currentStage/stageData 的）ChatApiResponse。 */
  send: (message: string, history: Message[]) => Promise<ChatApiResponse>;
  /** 每次 chat 响应后回调，供 workspace 更新 stage / stageData。 */
  onResult?: (data: ChatApiResponse) => void;
  /** 安全问答答对后的回调（正式模式 POST safety-quiz；体验模式本地无操作）。 */
  onSafetyPassed?: () => void | Promise<void>;
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

export default function ConversationChat({ initialMessages, stage, send, onResult, onSafetyPassed }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<SafetyQuiz | null>(null);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const doSend = async (text: string) => {
    if (text.trim() === '' || isLoading) return;

    const userMessage: Message = { id: uuidv4(), role: 'user', content: text, status: 'sent' };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      let data: ChatApiResponse;
      try {
        data = await send(text, messages);
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
        actionType: data.next_action_type,
        phaseComplete: data.phase_complete,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      onResult?.(data);

      // 结构化产出：安全问答 → 弹内联小测；数据表/报告框架 → 轻提示
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

  const handleOptionClick = (option: string) => doSend(option);

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

  // 最后一条助手消息的交互类型/选项
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  const lastActionType = lastAssistant?.actionType ?? null;
  const options =
    lastActionType === 'ask_choice' && lastAssistant?.options?.length ? lastAssistant.options : null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-white p-4">
        <StageProgress currentStage={stage} />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            isLastUser={false}
            onResend={noop}
            onEdit={noop}
          />
        ))}
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

      {options && options.length > 0 && (
        <div className="p-4 bg-gray-50">
          <div className="flex flex-wrap gap-2 justify-center">
            {options.map((option, index) => (
              <button
                key={index}
                onClick={() => handleOptionClick(option)}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200 transition-colors disabled:opacity-50"
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {lastActionType === 'confirmation' && (
        <div className="p-4 bg-gray-50">
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => doSend('确认')}
              disabled={isLoading}
              className="px-6 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50"
            >
              确认
            </button>
            <button
              onClick={() => doSend('取消')}
              disabled={isLoading}
              className="px-6 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 disabled:opacity-50"
            >
              取消
            </button>
          </div>
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
            className={`px-4 rounded-r-lg ${
              isLoading || inputValue.trim() === ''
                ? 'bg-gray-300 text-gray-500'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
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

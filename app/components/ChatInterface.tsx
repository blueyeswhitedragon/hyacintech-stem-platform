"use client";

import React, { useState, useRef, useEffect } from 'react';
import { usePhase } from '../lib/PhaseContext';
import { Message, ChatResponse, PhaseEnum } from '../models/types';
import { v4 as uuidv4 } from 'uuid';

interface ChatInterfaceProps {
  initialMessage?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ initialMessage }) => {
  const { currentPhase, transitionToNextPhase, phaseData, updatePhaseData } = usePhase();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthWarning, setHealthWarning] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 初始欢迎消息
  useEffect(() => {
    if (initialMessage) {
      setMessages([
        {
          id: uuidv4(),
          role: 'assistant',
          content: initialMessage
        }
      ]);
    } else {
      // 如果没有提供初始消息，则发送第一个请求
      sendInitialMessage();
    }
  }, [initialMessage]);

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 启动时健康检测
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => {
        if (data.status !== 'healthy') {
          const lines: string[] = [];
          if (!data.checks.config.ok) lines.push(`配置问题: ${data.checks.config.detail || '未知'}`);
          if (!data.checks.connectivity.ok) lines.push(`网络问题: ${data.checks.connectivity.detail || '无法连接'}`);
          if (!data.checks.auth.ok) lines.push(`鉴权问题: ${data.checks.auth.detail || '未知'}`);
          if (lines.length > 0) {
            setHealthWarning(lines.join('\n'));
          }
        }
      })
      .catch(() => {
        // health check itself failed — ignore, chat will surface errors
      });
  }, []);

  const sendInitialMessage = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: '你好，我想开始我的科学探究项目',
          phase: currentPhase,
          history: []
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || '请求失败');
      }

      const data: ChatResponse = await response.json();

      setMessages([{
        id: uuidv4(),
        role: 'assistant',
        content: data.dialogue,
        options: data.options,
        actionType: data.next_action_type,
        phaseComplete: data.phase_complete,
      }]);

    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      // If it's our structured error from the API, use it directly
      setError(msg !== '未知错误' ? msg : '初始化聊天失败，请检查网络连接和API配置后刷新重试。');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (inputValue.trim() === '' || isLoading) return;
    
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: inputValue
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage.content,
          phase: currentPhase,
          history: messages
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.message || '请求失败，请重试。');
        return;
      }
      
      const data: ChatResponse = await response.json();
      
      // 添加助手回复
      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: data.dialogue,
        options: data.options,
        actionType: data.next_action_type,
        phaseComplete: data.phase_complete,
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      
      // 如果当前阶段已完成，可以进入下一阶段
      if (data.phase_complete) {
        // 更新当前阶段的数据
        updatePhaseData(currentPhase, { completed: true });
        // 延迟1秒后转到下一阶段，给用户一个视觉提示
        setTimeout(() => {
          transitionToNextPhase({});
        }, 1000);
      }
      
    } catch (err) {
      const msg = err instanceof Error ? err.message : '发送消息失败，请重试';
      setError(msg !== '未知错误' ? msg : '发送消息失败，请重试');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // 处理选项按钮点击
  const handleOptionClick = (option: string) => {
    setInputValue(option);
    // 自动发送所选选项
    setTimeout(() => {
      sendMessage();
    }, 100);
  };

  // 提取最后一条助手消息中的选项（如果有）
  const getLastAssistantAction = (): {
    options: string[] | null;
    actionType: 'ask_choice' | 'text_input' | 'confirmation' | 'info' | null;
  } => {
    const assistantMessages = messages.filter(msg => msg.role === 'assistant');
    if (assistantMessages.length === 0) return { options: null, actionType: null };
    const lastMessage = assistantMessages[assistantMessages.length - 1];
    const actionType = lastMessage.actionType ?? null;
    const options = actionType === 'ask_choice' && lastMessage.options?.length
      ? lastMessage.options
      : null;
    return { options, actionType };
  };

  const { options, actionType: lastActionType } = getLastAssistantAction();

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* 健康诊断横幅 */}
        {healthWarning && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg text-sm text-yellow-800">
            <div className="flex items-start">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <div className="font-semibold mb-1">系统诊断</div>
                {healthWarning.split('\n').map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
              <button
                onClick={() => setHealthWarning(null)}
                className="ml-auto text-yellow-600 hover:text-yellow-800 flex-shrink-0"
              >
                ✕
              </button>
            </div>
          </div>
        )}
        {messages.map(message => (
          <div 
            key={message.id} 
            className={`mb-4 ${message.role === 'user' ? 'text-right' : 'text-left'}`}
          >
            <div 
              className={`inline-block rounded-lg px-4 py-2 max-w-3/4 ${
                message.role === 'user' 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {message.content}
            </div>
          </div>
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
            <div className="inline-block rounded-lg px-4 py-2 bg-red-100 text-red-800">
              {error}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      {/* 选项按钮（如果有） */}
      {options && options.length > 0 && (
        <div className="p-4 bg-gray-50">
          <div className="flex flex-wrap gap-2 justify-center">
            {options.map((option, index) => (
              <button
                key={index}
                onClick={() => handleOptionClick(option)}
                className="px-4 py-2 bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200 transition-colors"
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 确认/取消按钮 */}
      {lastActionType === 'confirmation' && (
        <div className="p-4 bg-gray-50">
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => { setInputValue('确认'); setTimeout(() => sendMessage(), 100); }}
              className="px-6 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors"
            >
              确认
            </button>
            <button
              onClick={() => { setInputValue('取消'); setTimeout(() => sendMessage(), 100); }}
              className="px-6 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 输入区域 */}
      <div className="border-t p-4 bg-white">
        <div className="flex">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题或回答..."
            className="flex-1 resize-none border rounded-l-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || inputValue.trim() === ''}
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
      
      {/* 加载动画的CSS */}
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
          0% {
            box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff;
          }
          16.667% {
            box-shadow: 9984px -6px 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff;
          }
          33.333% {
            box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff;
          }
          50% {
            box-shadow: 9984px 0 0 0 #9880ff, 9999px -6px 0 0 #9880ff, 10014px 0 0 0 #9880ff;
          }
          66.667% {
            box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff;
          }
          83.333% {
            box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px -6px 0 0 #9880ff;
          }
          100% {
            box-shadow: 9984px 0 0 0 #9880ff, 9999px 0 0 0 #9880ff, 10014px 0 0 0 #9880ff;
          }
        }
      `}</style>
    </div>
  );
};

export default ChatInterface;
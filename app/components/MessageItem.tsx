'use client';

import React, { useState } from 'react';
import { Message } from '../models/types';
import { confirmationDocumentBody } from '../lib/confirmationFlow';

interface MessageItemProps {
  message: Message;
  isLastUser: boolean;
  onResend: (id: string) => void;
  onEdit: (id: string) => void;
}

/**
 * 极简内联渲染：把成对的 **……** 渲染为 <strong>，其余文本原样输出。
 * 不引入 markdown 库（沙箱无 npm registry）；prompt 已约束模型只允许用 ** 加粗。
 */
function renderWithBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

const MessageItem: React.FC<MessageItemProps> = ({ message, isLastUser, onResend, onEdit }) => {
  const [hover, setHover] = useState(false);
  const isUser = message.role === 'user';
  const showActions = isUser && isLastUser && hover;
  const isConfirmationDoc = message.messageType === 'confirmation_doc';

  // 旧消息仍使用 confirmation_doc 类型，但学生端只显示紧凑确认状态。
  if (isConfirmationDoc) {
    return (
      <div className="mb-4 text-left">
        <div className="inline-flex max-w-[85%] items-start gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2">
          <span className="shrink-0 text-sm font-medium text-green-800">已确认研究问题</span>
          <span className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {renderWithBold(confirmationDocumentBody(message.content))}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mb-4 text-left"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="inline-flex items-start gap-1 max-w-[75%]">
        <div
          className={`rounded-lg px-4 py-2 whitespace-pre-wrap ${
            isUser
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {isUser ? message.content : renderWithBold(message.content)}
        </div>

        {showActions && (
          <div className="flex gap-0.5 flex-shrink-0 mt-1">
            <button
              onClick={(e) => { e.stopPropagation(); onResend(message.id); }}
              className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
              title="重新发送"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(message.id); }}
              className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
              title="编辑"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageItem;

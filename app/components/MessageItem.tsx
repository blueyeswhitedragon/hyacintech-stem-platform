'use client';

import React, { useState } from 'react';
import { Message } from '../models/types';

interface MessageItemProps {
  message: Message;
  isLastUser: boolean;
  onResend: (id: string) => void;
  onEdit: (id: string) => void;
}

const MessageItem: React.FC<MessageItemProps> = ({ message, isLastUser, onResend, onEdit }) => {
  const [hover, setHover] = useState(false);
  const isUser = message.role === 'user';
  const showActions = isUser && isLastUser && hover;
  const isConfirmationDoc = message.messageType === 'confirmation_doc';

  // 探究问题确认书 / 阶段确认书：以卡片样式渲染，区别于普通对话
  if (isConfirmationDoc) {
    return (
      <div className="mb-4 text-left">
        <div className="inline-block max-w-[85%] border-2 border-green-400 rounded-xl bg-green-50 shadow-sm overflow-hidden">
          <div className="bg-green-500 text-white px-4 py-1.5 text-sm font-medium">
            📋 探究问题确认书
          </div>
          <div className="px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {message.content}
          </div>
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
          className={`rounded-lg px-4 py-2 ${
            isUser
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {message.content}
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

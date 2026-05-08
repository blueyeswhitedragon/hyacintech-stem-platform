"use client";

import React, { useState } from 'react';
import { BLACKLIST_KEYWORDS } from '../prompts';

interface SafetyFilterProps {
  onCheck: (text: string, isSafe: boolean, keyword?: string) => void;
  children: React.ReactNode;
}

const SafetyFilter: React.FC<SafetyFilterProps> = ({ onCheck, children }) => {
  const [safetyModalOpen, setSafetyModalOpen] = useState(false);
  const [detectedKeyword, setDetectedKeyword] = useState<string>('');
  const [blockedText, setBlockedText] = useState<string>('');

  // 检查输入文本是否包含黑名单关键词
  const checkSafety = (text: string): boolean => {
    const lowercaseText = text.toLowerCase();
    
    for (const keyword of BLACKLIST_KEYWORDS) {
      if (lowercaseText.includes(keyword.toLowerCase())) {
        setDetectedKeyword(keyword);
        setBlockedText(text);
        setSafetyModalOpen(true);
        onCheck(text, false, keyword);
        return false;
      }
    }
    
    onCheck(text, true);
    return true;
  };

  const closeModal = () => {
    setSafetyModalOpen(false);
  };

  return (
    <>
      {/* 通过React.cloneElement添加安全检查功能到子组件 */}
      {React.Children.map(children, child => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, {
            checkSafety
          });
        }
        return child;
      })}
      
      {/* 安全警告模态框 */}
      {safetyModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-auto">
            <div className="flex items-center text-red-600 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h3 className="text-lg font-semibold">安全提醒</h3>
            </div>
            
            <p className="mb-4">
              您的请求包含可能存在安全风险的内容 <span className="font-semibold">"{detectedKeyword}"</span>。
            </p>
            
            <p className="mb-4">
              为确保实验安全，请避免使用危险物品或进行危险操作。可以考虑使用更安全的替代方法。
            </p>
            
            <div className="p-2 bg-gray-50 rounded mb-4 text-sm">
              <p>建议：</p>
              {detectedKeyword.includes('酸') && (
                <p>• 使用柠檬汁、醋等弱酸性物质代替强酸</p>
              )}
              {detectedKeyword.includes('电') && (
                <p>• 使用电池（1.5V-9V）代替高压电源</p>
              )}
              {detectedKeyword.includes('解剖') && (
                <p>• 使用模型或视频资料代替活体实验</p>
              )}
            </div>
            
            <div className="flex justify-end">
              <button
                onClick={closeModal}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                我明白了
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SafetyFilter;
"use client";

import React from 'react';

// 阶段名（1–6），与 PhaseIndicator 一致
const STAGE_NAMES: Record<number, string> = {
  1: '选题定向',
  2: '方案设计',
  3: '过程执行',
  4: '数据分析',
  5: '成果成型',
  6: '结果反思',
};

export default function StageProgress({ currentStage }: { currentStage: number }) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between relative">
        <div className="absolute h-1 bg-gray-200 left-0 right-0 top-4 -translate-y-1/2 z-0" />
        {Object.entries(STAGE_NAMES).map(([num, name]) => {
          const stage = parseInt(num, 10);
          const isActive = currentStage === stage;
          const isCompleted = currentStage > stage;
          return (
            <div key={stage} className="flex flex-col items-center relative z-10">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm
                  ${isActive ? 'bg-blue-500 text-white' : isCompleted ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}
              >
                {isCompleted ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  stage
                )}
              </div>
              <span className={`text-xs mt-1 ${isActive ? 'text-blue-600 font-medium' : 'text-gray-500'}`}>
                {name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

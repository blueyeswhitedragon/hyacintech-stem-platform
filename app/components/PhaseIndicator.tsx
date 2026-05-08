"use client";

import React from 'react';
import { usePhase } from '../lib/PhaseContext';
import { PhaseEnum } from '../models/types';

const phaseNames = {
  [PhaseEnum.TopicSelection]: '选题定向',
  [PhaseEnum.PlanDesign]: '方案设计',
  [PhaseEnum.Execution]: '过程执行',
  [PhaseEnum.DataAnalysis]: '数据分析',
  [PhaseEnum.ResultsFormation]: '成果成型',
  [PhaseEnum.Reflection]: '结果反思',
};

const PhaseIndicator = () => {
  const { currentPhase } = usePhase();
  
  return (
    <div className="w-full mb-8">
      <h2 className="text-lg font-semibold mb-4 text-center">科学探究流程</h2>
      <div className="w-full flex items-center justify-between relative">
        {/* 连接线 */}
        <div className="absolute h-1 bg-gray-200 left-0 right-0 top-1/2 transform -translate-y-1/2 z-0"></div>
        
        {/* 阶段指示点 */}
        {Object.entries(phaseNames).map(([phaseNum, phaseName]) => {
          const phaseNumber = parseInt(phaseNum);
          const isActive = currentPhase === phaseNumber;
          const isCompleted = currentPhase > phaseNumber;
          
          return (
            <div key={phaseNumber} className="flex flex-col items-center relative z-10">
              <div 
                className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 
                  ${isActive ? 'bg-blue-500 text-white' : 
                    isCompleted ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}
              >
                {isCompleted ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  phaseNumber
                )}
              </div>
              <span className={`text-xs font-medium ${isActive ? 'text-blue-500' : 'text-gray-500'}`}>
                {phaseName}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PhaseIndicator;
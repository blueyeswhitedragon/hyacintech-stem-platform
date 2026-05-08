"use client";

import React, { createContext, useState, useContext, ReactNode } from 'react';
import { PhaseEnum, PhaseData } from '../models/types';

interface PhaseContextType {
  currentPhase: PhaseEnum;
  phaseData: PhaseData;
  transitionToNextPhase: (data: any) => boolean;
  updatePhaseData: (phase: PhaseEnum, data: any) => void;
  canTransitionToNextPhase: (phase: PhaseEnum) => boolean;
}

const PhaseContext = createContext<PhaseContextType | undefined>(undefined);

export function PhaseProvider({ children }: { children: ReactNode }) {
  const [currentPhase, setCurrentPhase] = useState<PhaseEnum>(PhaseEnum.TopicSelection);
  const [phaseData, setPhaseData] = useState<PhaseData>({});

  const canTransitionToNextPhase = (phase: PhaseEnum): boolean => {
    switch (phase) {
      case PhaseEnum.TopicSelection:
        const topicData = phaseData[PhaseEnum.TopicSelection];
        return !!(topicData?.selectedTopic && topicData?.researchQuestion);
      
      case PhaseEnum.PlanDesign:
        const planData = phaseData[PhaseEnum.PlanDesign];
        return !!(planData?.variables?.independent && 
                 planData?.variables?.dependent && 
                 planData?.materials && 
                 planData?.procedure);
      
      case PhaseEnum.Execution:
        const executionData = phaseData[PhaseEnum.Execution];
        return !!(executionData?.rawData && executionData?.observations);
      
      case PhaseEnum.DataAnalysis:
        const analysisData = phaseData[PhaseEnum.DataAnalysis];
        return !!(analysisData?.analyzedData && analysisData?.findings);
      
      case PhaseEnum.ResultsFormation:
        const resultData = phaseData[PhaseEnum.ResultsFormation];
        return !!(resultData?.conclusion && resultData?.report);
      
      case PhaseEnum.Reflection:
        const reflectionData = phaseData[PhaseEnum.Reflection];
        return !!(reflectionData?.improvements && reflectionData?.nextSteps);
      
      default:
        return false;
    }
  };

  const transitionToNextPhase = (data: any): boolean => {
    if (canTransitionToNextPhase(currentPhase)) {
      // 更新当前阶段的数据
      updatePhaseData(currentPhase, data);
      
      // 如果不是最后一个阶段，则进入下一阶段
      if (currentPhase < PhaseEnum.Reflection) {
        setCurrentPhase(currentPhase + 1);
      }
      
      return true;
    }
    
    return false;
  };

  const updatePhaseData = (phase: PhaseEnum, data: any) => {
    setPhaseData(prevData => ({
      ...prevData,
      [phase]: {
        ...prevData[phase],
        ...data
      }
    }));
  };

  return (
    <PhaseContext.Provider value={{
      currentPhase,
      phaseData,
      transitionToNextPhase,
      updatePhaseData,
      canTransitionToNextPhase
    }}>
      {children}
    </PhaseContext.Provider>
  );
}

export function usePhase() {
  const context = useContext(PhaseContext);
  if (context === undefined) {
    throw new Error('usePhase must be used within a PhaseProvider');
  }
  return context;
}